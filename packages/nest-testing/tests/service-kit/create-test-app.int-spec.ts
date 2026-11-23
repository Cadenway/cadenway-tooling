import { connect as connectTcp, type Socket } from 'node:net';

import {
  baseConfigShape,
  createApplication,
  getOrganizationContext,
  internalTokenVerifierConfigShape,
  InternalTokenSigner,
  InternalTokenVerifier,
  loadConfig,
  ProblemException,
  type BaseConfig,
  type InternalPrincipal,
  type InternalTokenClaims,
  type InternalTokenVerifierConfig,
} from '@cadenway/nest-common';
import {
  databaseConfigShape,
  DatabaseModule,
  TenantTransactionRunner,
  type DatabaseConfig,
  type TransactionScope,
} from '@cadenway/nest-common/database';
import {
  EventConsumers,
  EventPublisher,
  messagingConfigShape,
  MessagingModule,
  type EventSchemas,
  type MessagingConfig,
} from '@cadenway/nest-messaging';
import { jetstream } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { http, HttpResponse } from 'msw';
import request, { type Response as HttpResult } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { fixtures } from '../../src/fixtures/fixtures.js';
import type { FixtureTask } from '../../src/fixtures/sprint-14.js';
import type { RecordedEvent } from '../../src/nats/event-recorder.js';
import {
  assertTenantIsolation,
  findUnprotectedTables,
} from '../../src/postgres/tenant-isolation.js';
import {
  writeSampleMigrations,
  type SampleMigrations,
} from '../../src/testing/sample-migrations.js';
import {
  createTestApp,
  type TestApp,
  type TestInfrastructure,
} from '../../src/app/create-test-app.js';

/**
 * Constant CONTAINER_START_TIMEOUT_MS
 *
 * @description
 * Time given to a test that starts a container itself: a first run also pulls the image.
 *
 * @type {number}
 */
const CONTAINER_START_TIMEOUT_MS: number = 180_000;

const tokenFactories = {
  createSigner: InternalTokenSigner.create,
  createVerifier: InternalTokenVerifier.create,
};

/**
 * Interface SampleConfig
 *
 * @description
 * Configuration of the sample service, read from the environment `createTestApp` sets.
 */
interface SampleConfig
  extends BaseConfig, DatabaseConfig, InternalTokenVerifierConfig, MessagingConfig {
  // #region Properties
  /**
   * Property MIGRATION_DATABASE_URL
   *
   * @description
   * Connection string of the migrator role, which `src/migrate.ts` of a service reads.
   *
   * @type {string}
   * @readonly
   */
  readonly MIGRATION_DATABASE_URL: string;

  /**
   * Property CHAT_WEBHOOK_URL
   *
   * @description
   * Third-party address the service notifies.
   *
   * @type {string}
   * @readonly
   */
  readonly CHAT_WEBHOOK_URL: string;
  // #endregion
}

/**
 * Constant SAMPLE_CONFIG
 *
 * @description
 * Injection token of the validated configuration.
 *
 * @type {symbol}
 */
const SAMPLE_CONFIG: unique symbol = Symbol('SAMPLE_CONFIG');

/**
 * Constant ENVELOPE
 *
 * @description
 * Fields every Cadenway event carries, as `@cadenway/nest-messaging` reads them.
 *
 * @type {z.ZodRawShape}
 */
const ENVELOPE = {
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  organizationId: z.uuid().nullable(),
  actor: z.object({ type: z.enum(['user', 'automation', 'git', 'system']), id: z.string() }),
  version: z.number().int(),
};

/**
 * Constant SAMPLE_EVENTS
 *
 * @description
 * Event schemas of the sample service. A real service passes the `eventSchemas` of
 * `@cadenway/contracts`; the kit only needs zod validators of the envelope, by event name.
 *
 * @type {EventSchemas}
 */
const SAMPLE_EVENTS = {
  'task.status-changed.v1': z.object({ ...ENVELOPE, taskId: z.string(), status: z.string() }),
  'organization.deleted.v1': z.object(ENVELOPE),
} satisfies EventSchemas;

/**
 * Class OrganizationDeletedHandler
 *
 * @description
 * Consumes `organization.deleted.v1` through a durable consumer of `@cadenway/nest-messaging`,
 * as the sample service's own NATS user.
 */
@Injectable()
class OrganizationDeletedHandler implements OnApplicationBootstrap {
  // #region Properties
  /**
   * Property received
   *
   * @description
   * Payloads handled, in order.
   *
   * @type {unknown[]}
   * @readonly
   */
  public readonly received: unknown[] = [];
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the consumers of the kit.
   *
   * @param {EventConsumers} consumers - Consumers of `@cadenway/nest-messaging`.
   * @constructor
   */
  public constructor(@Inject(EventConsumers) private readonly consumers: EventConsumers) {}
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the handler, which creates its durable consumer `task-service__purge-organization`.
   *
   * @returns {Promise<void>} Resolves once subscribed.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.consumers.subscribe({
      handler: 'purge-organization',
      schemas: SAMPLE_EVENTS,
      event: 'organization.deleted.v1',
      handle: (payload: unknown): Promise<void> => {
        this.received.push(payload);
        return Promise.resolve();
      },
    });
  }
  // #endregion
}

/**
 * Class TaskController
 *
 * @description
 * Internal routes of the sample service: guarded by the internal token, scoped by the tenant
 * transaction runner.
 */
@Controller('internal/v1/tasks')
class TaskController {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the runner, the publisher and the configuration.
   *
   * @param {TenantTransactionRunner} tenant - Tenant transaction runner of the kit.
   * @param {EventPublisher} events - Event publisher of `@cadenway/nest-messaging`.
   * @param {SampleConfig} config - Validated configuration.
   * @constructor
   */
  public constructor(
    @Inject(TenantTransactionRunner) private readonly tenant: TenantTransactionRunner,
    @Inject(EventPublisher) private readonly events: EventPublisher,
    @Inject(SAMPLE_CONFIG) private readonly config: SampleConfig,
  ) {}
  // #endregion

  // #region Methods
  /**
   * Method list
   *
   * @description
   * Lists the tasks the organization of the token can see. The query has no organization
   * filter on purpose: row-level security alone decides here.
   *
   * @returns {Promise<{ items: unknown[] }>} The visible tasks.
   */
  @Get()
  public async list(): Promise<{ items: unknown[] }> {
    const result: { rows: unknown[] } = await this.tenant.run((tx: TransactionScope) =>
      tx.client.query('select display_key as id, title, status from tasks order by display_key'),
    );
    return { items: result.rows };
  }

  /**
   * Method complete
   *
   * @description
   * Marks a task as done, publishes the change and notifies a third party.
   *
   * @param {string} id - Display key of the task.
   * @returns {Promise<{ id: string; status: string }>} The new state.
   */
  @Post(':id/complete')
  @HttpCode(200)
  public async complete(@Param('id') id: string): Promise<{ id: string; status: string }> {
    const updated: { rows: unknown[] } = await this.tenant.run((tx: TransactionScope) =>
      tx.client.query(
        "update tasks set status = 'done' where display_key = $1 returning organization_id",
        [id],
      ),
    );
    const organizationId: string | undefined = (
      updated.rows[0] as { organization_id: string } | undefined
    )?.organization_id;
    if (organizationId === undefined) {
      throw new ProblemException({ status: 404, code: 'task.not-found' });
    }
    // A gateway-style publish, without an outbox: the sample has no outbox table.
    await this.events.publish(SAMPLE_EVENTS, 'task.status-changed.v1', {
      organizationId,
      actor: { type: 'user', id: getOrganizationContext()?.actor.id ?? 'unknown' },
      version: 1,
      taskId: id,
      status: 'done',
    });
    const notified: Response = await fetch(this.config.CHAT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${id} is done` }),
    });
    if (!notified.ok) {
      throw new ProblemException({ status: 503, code: 'chat.unavailable' });
    }
    return { id, status: 'done' };
  }
  // #endregion
}

/**
 * Function createSampleService
 *
 * @description
 * Builds the sample service the way a Cadenway `main.ts` does: the configuration validated from
 * `process.env`, then `createApplication` of the kit with the internal token verifier.
 *
 * @returns {Promise<NestExpressApplication>} The application, not initialized.
 */
async function createSampleService(): Promise<NestExpressApplication> {
  const config: Readonly<SampleConfig> = loadConfig<SampleConfig>(
    z.object({
      ...baseConfigShape,
      ...databaseConfigShape,
      ...internalTokenVerifierConfigShape,
      ...messagingConfigShape,
      MIGRATION_DATABASE_URL: z.url(),
      CHAT_WEBHOOK_URL: z.url(),
    }),
  );

  /**
   * Class AppModule
   *
   * @description
   * Module of the sample service, declared once the configuration is known.
   */
  @Module({
    imports: [
      DatabaseModule.forRoot({ connectionString: config.DATABASE_URL }),
      // As a deployed service: its own NATS user, and the streams left to cadenway-ops.
      MessagingModule.forRoot({
        service: 'task-service',
        servers: config.NATS_URL,
        ...(config.NATS_USER === undefined ? {} : { user: config.NATS_USER }),
        ...(config.NATS_PASSWORD === undefined ? {} : { password: config.NATS_PASSWORD }),
      }),
    ],
    controllers: [TaskController],
    providers: [{ provide: SAMPLE_CONFIG, useValue: config }, OrganizationDeletedHandler],
  })
  class AppModule {}

  return createApplication(AppModule, {
    service: 'task-service',
    version: '0.0.0',
    config,
    internalToken: {
      verifier: {
        audience: config.INTERNAL_TOKEN_AUDIENCE,
        trustedIssuers: config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
      },
    },
  });
}

/**
 * Function ping
 *
 * @description
 * Sends `PING` to a Redis server over a plain socket.
 *
 * @param {string} url - `redis://host:port` address.
 * @returns {Promise<string>} The reply line.
 */
function ping(url: string): Promise<string> {
  const address: URL = new URL(url);
  return new Promise<string>((resolve: (reply: string) => void, reject: (error: Error) => void) => {
    const socket: Socket = connectTcp(Number(address.port), address.hostname, (): void => {
      socket.write('PING\r\n');
    });
    socket.once('data', (data: Buffer): void => {
      socket.destroy();
      resolve(data.toString().trim());
    });
    socket.once('error', reject);
    // A port whose container was just removed may accept the connection and close it at once.
    socket.once('close', (): void => {
      reject(new Error('The server closed the connection without answering.'));
    });
  });
}

describe('createTestApp for a service', () => {
  const nord: ReturnType<typeof fixtures.atelierNord> = fixtures.atelierNord();
  const lumen: ReturnType<typeof fixtures.cooperativeLumen> = fixtures.cooperativeLumen();
  const before: string | undefined = process.env.DATABASE_URL;
  let migrations: SampleMigrations;
  let testApp: TestApp<NestExpressApplication, InternalTokenClaims, InternalPrincipal>;
  let seenDuringCreate: string | undefined;
  let notifications: unknown[];

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    migrations = writeSampleMigrations();
    testApp = await createTestApp({
      tokenFactories,
      service: 'task-service',
      migrationsFolder: migrations.folder,
      issuers: ['api-gateway', 'automation-service'],
      env: { CHAT_WEBHOOK_URL: 'https://hooks.chat.test/notify' },
      create: (): Promise<NestExpressApplication> => {
        seenDuringCreate = process.env.DATABASE_URL;
        return createSampleService();
      },
    });
  });

  beforeEach(async () => {
    notifications = [];
    testApp.http.use(
      http.post('https://hooks.chat.test/notify', async ({ request: received }) => {
        notifications.push(await received.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    await testApp.database.reset();
    await testApp.events.clear();
    const rows: readonly FixtureTask[] = [
      fixtures.sprint14().task('CAD-482'),
      fixtures.sprint14().task('CAD-479'),
    ];
    for (const task of rows) {
      await testApp.database.admin.query(
        'insert into tasks (id, organization_id, display_key, title, status) values ($1, $2, $3, $4, $5)',
        [task.uuid, nord.organization.id, task.id, task.name, task.status],
      );
    }
    await testApp.database.admin.query(
      "insert into tasks (organization_id, display_key, title, status) values ($1, 'LUM-1', 'Autre', 'todo')",
      [lumen.organization.id],
    );
  });

  afterEach(() => {
    testApp.http.reset();
  });

  afterAll(async () => {
    await testApp.close();
    migrations.remove();
    vi.restoreAllMocks();
  });

  it('sets the environment before the application is created', () => {
    expect(seenDuringCreate).toBe(testApp.database.appUrl);
    expect(process.env.DATABASE_URL).toBe(testApp.database.appUrl);
    expect(testApp.env).toMatchObject({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testApp.database.appUrl,
      MIGRATION_DATABASE_URL: testApp.database.migratorUrl,
      NATS_URL: testApp.nats.url,
      NATS_USER: 'task',
      NATS_PASSWORD: testApp.nats.user.password,
      INTERNAL_TOKEN_AUDIENCE: 'task-service',
      CHAT_WEBHOOK_URL: 'https://hooks.chat.test/notify',
    });
    expect(testApp.env.REDIS_URL).toBeUndefined();
  });

  it('gives the service the NATS user of its backend, held to its own subjects', async () => {
    const service: NatsConnection = await connect({
      servers: testApp.env.NATS_URL ?? '',
      user: testApp.env.NATS_USER ?? '',
      pass: testApp.env.NATS_PASSWORD ?? '',
      inboxPrefix: '_INBOX.task',
    });
    try {
      await expect(
        jetstream(service, { timeout: 2000 }).publish(
          'evt.member.removed.v1',
          JSON.stringify({ id: 'evt-member-removed' }),
          { msgID: 'evt-member-removed' },
        ),
      ).rejects.toThrow(/Permissions Violation for Publish to "evt\.member\.removed\.v1"/u);
    } finally {
      await service.close();
    }

    await testApp.events.sync();
    expect(testApp.events.named('member.removed.v1')).toEqual([]);
  });

  it('runs the application as the application role of the service', async () => {
    const session: { rows: { role: string; database: string }[] } =
      await testApp.database.app.query(
        'select current_user as role, current_database() as database',
      );

    expect(session.rows[0]).toEqual({ role: 'task_app', database: 'task' });
    expect(new URL(testApp.env.DATABASE_URL ?? '').username).toBe('task_app');
    expect(new URL(testApp.env.MIGRATION_DATABASE_URL ?? '').username).toBe('task_migrator');
  });

  it('refuses a call without an internal token', async () => {
    const response: HttpResult = await request(testApp.app.getHttpServer())
      .get('/internal/v1/tasks')
      .expect(401);

    expect(response.body).toMatchObject({ status: 401, code: 'auth.token-missing' });
  });

  it('refuses a token issued for another service', async () => {
    const response: HttpResult = await request(testApp.app.getHttpServer())
      .get('/internal/v1/tasks')
      .set(
        'Authorization',
        await testApp.tokens.authorization(
          { actor: { type: 'user', id: nord.CM.id }, organizationId: nord.organization.id },
          { audience: 'billing-service' },
        ),
      )
      .expect(401);

    expect(response.body).toMatchObject({ code: 'auth.token-invalid' });
  });

  it('serves a guarded route to a signed call, scoped to its organization', async () => {
    const response: HttpResult = await request(testApp.app.getHttpServer())
      .get('/internal/v1/tasks')
      .set(
        'Authorization',
        await testApp.tokens.authorization({
          actor: { type: 'user', id: nord.CM.id },
          organizationId: nord.organization.id,
          role: nord.CM.role,
        }),
      )
      .expect(200);

    expect(response.body).toEqual({
      items: [
        { id: 'CAD-479', title: 'Limiter le débit des jetons d’API', status: 'progress' },
        { id: 'CAD-482', title: 'Refondre l’écran de connexion SSO', status: 'progress' },
      ],
    });
  });

  it('shows another organization none of those rows', async () => {
    const response: HttpResult = await request(testApp.app.getHttpServer())
      .get('/internal/v1/tasks')
      .set(
        'Authorization',
        await testApp.tokens.authorization(
          { actor: { type: 'automation', id: 'rule-1' }, organizationId: lumen.organization.id },
          { issuer: 'automation-service' },
        ),
      )
      .expect(200);

    expect(response.body).toEqual({ items: [{ id: 'LUM-1', title: 'Autre', status: 'todo' }] });
    await assertTenantIsolation(testApp.database, {
      table: 'tasks',
      organizationId: nord.organization.id,
      otherOrganizationId: lumen.organization.id,
    });
    expect(await findUnprotectedTables(testApp.database)).toEqual([]);
  });

  it('records the event the application publishes and fakes the third party it calls', async () => {
    await request(testApp.app.getHttpServer())
      .post('/internal/v1/tasks/CAD-482/complete')
      .set(
        'Authorization',
        await testApp.tokens.authorization({
          actor: { type: 'user', id: nord.CM.id },
          organizationId: nord.organization.id,
        }),
      )
      .expect(200, { id: 'CAD-482', status: 'done' });

    // Published by EventPublisher of @cadenway/nest-messaging with the service's own NATS user,
    // read by the recorder as admin.
    const event: RecordedEvent<{ id: string }> = await testApp.events.waitFor<{ id: string }>(
      'task.status-changed.v1',
    );
    expect(event.payload).toMatchObject({
      organizationId: nord.organization.id,
      actor: { type: 'user', id: nord.CM.id },
      taskId: 'CAD-482',
      status: 'done',
    });
    expect(event.headers).toMatchObject({
      'Nats-Msg-Id': event.payload.id,
      'Cadenway-Event-Name': 'task.status-changed.v1',
      'Cadenway-Organization-Id': nord.organization.id,
    });
    expect(notifications).toEqual([{ text: 'CAD-482 is done' }]);
    expect(testApp.http.unhandled).toEqual([]);
    const status: { rows: { status: string }[] } = await testApp.database.admin.query(
      "select status from tasks where display_key = 'CAD-482'",
    );
    expect(status.rows[0]?.status).toBe('done');
  });

  it('publishes nothing for a task of another organization', async () => {
    await request(testApp.app.getHttpServer())
      .post('/internal/v1/tasks/CAD-482/complete')
      .set(
        'Authorization',
        await testApp.tokens.authorization({
          actor: { type: 'user', id: lumen.CM.id },
          organizationId: lumen.organization.id,
        }),
      )
      .expect(404);

    await testApp.events.sync();
    expect(testApp.events.events).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('fails the call to a third party no fake answers, without reaching the network', async () => {
    testApp.http.reset();

    await request(testApp.app.getHttpServer())
      .post('/internal/v1/tasks/CAD-479/complete')
      .set(
        'Authorization',
        await testApp.tokens.authorization({
          actor: { type: 'user', id: nord.CM.id },
          organizationId: nord.organization.id,
        }),
      )
      .expect(500);

    expect(testApp.http.unhandled).toEqual(['POST https://hooks.chat.test/notify']);
  });

  it('feeds a handler an event another service would publish', async () => {
    const deleted: { id: string; organizationId: string } = {
      id: '019a0000-0000-7000-8000-00000000d001',
      organizationId: lumen.organization.id,
    };
    await testApp.nats.publish('organization.deleted.v1', {
      ...deleted,
      occurredAt: '2026-11-15T09:00:00.000Z',
      actor: { type: 'system', id: 'organization-service' },
      version: 1,
    });

    const event: RecordedEvent = await testApp.events.waitFor('organization.deleted.v1');
    expect(event.headers['Nats-Msg-Id']).toBe(deleted.id);
    // The durable consumer of @cadenway/nest-messaging, created with the service's own user.
    const handler: OrganizationDeletedHandler = testApp.app.get(OrganizationDeletedHandler);
    await vi.waitFor(
      () => {
        expect(handler.received).toEqual([expect.objectContaining(deleted)]);
      },
      { timeout: 10_000 },
    );
  });

  it('says which option starts a dependency that was not asked for', () => {
    expect(() => testApp.redis).toThrow('No Redis: call createTestApp with redis: true.');
  });

  it('restores the environment and removes the containers on close', async () => {
    const appUrl: string = testApp.database.appUrl;
    const natsUrl: string = testApp.nats.url;
    const { default: pg } = await import('pg');

    await testApp.close();
    // Closing twice is harmless: afterAll closes again.
    await testApp.close();

    expect(process.env.DATABASE_URL).toBe(before);
    expect(process.env.INTERNAL_TOKEN_AUDIENCE).toBeUndefined();
    expect(process.env.NATS_PASSWORD).toBeUndefined();
    const client: InstanceType<typeof pg.Client> = new pg.Client({
      connectionString: appUrl,
      connectionTimeoutMillis: 3000,
    });
    await expect(client.connect()).rejects.toThrow();
    await expect(connect({ servers: natsUrl, timeout: 2000 })).rejects.toThrow();
    // The fakes stopped with the application: nothing is intercepted any more.
    expect(testApp.http.unhandled).toEqual([]);
  });
});

describe('createTestApp for a gateway', () => {
  it(
    'starts Redis only, and gives the signing key of the gateway',
    async () => {
      const closed: string[] = [];
      const testApp: TestApp<
        { init(): Promise<void>; close(): Promise<void> },
        InternalTokenClaims,
        InternalPrincipal
      > = await createTestApp({
        tokenFactories,
        service: 'api-gateway',
        postgres: false,
        nats: false,
        redis: true,
        env: (infrastructure: TestInfrastructure<InternalTokenClaims, InternalPrincipal>) =>
          infrastructure.tokens.signerEnv(),
        create: (): Promise<{ init(): Promise<void>; close(): Promise<void> }> =>
          Promise.resolve({
            init: (): Promise<void> => Promise.resolve(),
            close: (): Promise<void> => {
              closed.push('application');
              return Promise.resolve();
            },
          }),
      });
      try {
        expect(await ping(testApp.redis.url)).toBe('+PONG');
        expect(testApp.env).toMatchObject({
          REDIS_URL: testApp.redis.url,
          INTERNAL_TOKEN_ISSUER: 'api-gateway',
        });
        expect(testApp.env.DATABASE_URL).toBeUndefined();
        expect(testApp.env.NATS_URL).toBeUndefined();
        expect(() => testApp.database).toThrow('No PostgreSQL');
        expect(() => testApp.nats).toThrow('No NATS');
        expect(() => testApp.events).toThrow('No event recorder');

        // What the gateway signs for a faked service is checked with the same keys.
        const forwarded: string = await testApp.tokens.sign(
          {
            actor: { type: 'user', id: fixtures.atelierNord().CM.id },
            organizationId: fixtures.atelierNord().organization.id,
          },
          { audience: 'task-service' },
        );
        expect(await testApp.tokens.verify(forwarded, 'task-service')).toMatchObject({
          issuer: 'api-gateway',
          organizationId: fixtures.atelierNord().organization.id,
        });
      } finally {
        const redisUrl: string = testApp.redis.url;
        await testApp.close();
        expect(closed).toEqual(['application']);
        await expect(ping(redisUrl)).rejects.toThrow();
      }
    },
    CONTAINER_START_TIMEOUT_MS,
  );
});
