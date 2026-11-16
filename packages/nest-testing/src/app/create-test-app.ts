import type { AnyHandler } from 'msw';

import { createTestInternalTokens, type TestInternalTokens } from '../auth/internal-tokens.js';
import { startHttpFakes, type HttpFakes } from '../http/http-fakes.js';
import type { EventRecorder } from '../nats/event-recorder.js';
import { grantOf, natsUserNameOf, type TestNatsUser } from '../nats/nats-users.js';
import { startTestNats, type TestNats, type TestStream } from '../nats/test-nats.js';
import { startTestDatabase, type TestDatabase } from '../postgres/test-database.js';
import { startTestRedis, type TestRedis } from '../redis/test-redis.js';

/**
 * Type TestEnvironment
 *
 * @description
 * Environment variables of the application under test, by name.
 *
 * @type {Readonly<Record<string, string>>}
 */
export type TestEnvironment = Readonly<Record<string, string>>;

/**
 * Interface TestApplication
 *
 * @description
 * What `createTestApp` needs of the application under test. A NestJS `INestApplication` fits.
 */
export interface TestApplication {
  // #region Methods
  /**
   * Method init
   *
   * @description
   * Initializes the application without listening.
   *
   * @returns {Promise<unknown>} Resolves once initialized.
   */
  init(): Promise<unknown>;

  /**
   * Method close
   *
   * @description
   * Closes the application and its connections.
   *
   * @returns {Promise<unknown>} Resolves once closed.
   */
  close(): Promise<unknown>;
  // #endregion
}

/**
 * Interface TestInfrastructure
 *
 * @description
 * The disposable dependencies started for one application under test.
 */
export interface TestInfrastructure {
  // #region Properties
  /**
   * Property env
   *
   * @description
   * Environment variables given to the application: they are set on `process.env` before the
   * application is created and restored when the test application closes.
   *
   * @type {TestEnvironment}
   * @readonly
   */
  readonly env: TestEnvironment;

  /**
   * Property database
   *
   * @description
   * The disposable PostgreSQL, migrated. Reading it throws when `postgres` was switched off.
   *
   * @type {TestDatabase}
   * @readonly
   */
  readonly database: TestDatabase;

  /**
   * Property nats
   *
   * @description
   * The disposable NATS server. Reading it throws when `nats` was switched off.
   *
   * @type {TestNats}
   * @readonly
   */
  readonly nats: TestNats;

  /**
   * Property events
   *
   * @description
   * Recorder of every event published on the `EVENTS` stream. Reading it throws when `nats` was
   * switched off.
   *
   * @type {EventRecorder}
   * @readonly
   */
  readonly events: EventRecorder;

  /**
   * Property redis
   *
   * @description
   * The disposable Redis server. Reading it throws unless `redis` was switched on.
   *
   * @type {TestRedis}
   * @readonly
   */
  readonly redis: TestRedis;

  /**
   * Property tokens
   *
   * @description
   * Internal token keys of the run: the application trusts them, the test signs with them.
   *
   * @type {TestInternalTokens}
   * @readonly
   */
  readonly tokens: TestInternalTokens;

  /**
   * Property http
   *
   * @description
   * Fakes of the third-party HTTP systems. They are always running: without a handler, a
   * request to anything but a loopback address fails.
   *
   * @type {HttpFakes}
   * @readonly
   */
  readonly http: HttpFakes;
  // #endregion
}

/**
 * Interface CreateTestAppOptions
 *
 * @description
 * Options of `createTestApp`.
 *
 * @template TApp Type of the application under test.
 */
export interface CreateTestAppOptions<TApp extends TestApplication> {
  // #region Properties
  /**
   * Property service
   *
   * @description
   * Name of the service or gateway under test, such as `task-service`. It names the database and
   * its roles, and is the audience of the internal tokens.
   *
   * @type {string}
   * @readonly
   */
  readonly service: string;

  /**
   * Property create
   *
   * @description
   * Builds the application once the dependencies run and `process.env` is set. Import the
   * application module inside this function, not at the top of the spec: a module that
   * validates its configuration when it is declared must see the test environment.
   * `createTestApp` then calls `init`; the application never listens.
   *
   * @type {(infrastructure: TestInfrastructure) => Promise<TApp>}
   * @readonly
   */
  readonly create: (infrastructure: TestInfrastructure) => Promise<TApp>;

  /**
   * Property postgres
   *
   * @description
   * Whether to start PostgreSQL. Defaults to `true`; a gateway sets `false`.
   *
   * @type {boolean | undefined}
   * @readonly
   */
  readonly postgres?: boolean;

  /**
   * Property nats
   *
   * @description
   * Whether to start NATS and record events. Defaults to `true`.
   *
   * @type {boolean | undefined}
   * @readonly
   */
  readonly nats?: boolean;

  /**
   * Property redis
   *
   * @description
   * Whether to start Redis. Defaults to `false`; a gateway sets `true`.
   *
   * @type {boolean | undefined}
   * @readonly
   */
  readonly redis?: boolean;

  /**
   * Property migrationsFolder
   *
   * @description
   * Folder of the Drizzle migrations of the service, applied as the migrator role before the
   * application starts: `migrations` in a Cadenway service.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly migrationsFolder?: string;

  /**
   * Property migrate
   *
   * @description
   * Further preparation of the database, run after the migrations: a spec that owns its tables
   * creates them here.
   *
   * @type {((database: TestDatabase) => Promise<void>) | undefined}
   * @readonly
   */
  readonly migrate?: (database: TestDatabase) => Promise<void>;

  /**
   * Property natsUser
   *
   * @description
   * NATS user of the application. Defaults to the user cadenway-ops gives the service, named
   * after it (`task-service` gives `task`), with the permissions of that backend: it publishes
   * the events of its own entities only, and its client must use the inbox prefix
   * `_INBOX.<user>`. A name that is not a Cadenway backend needs a `grant`.
   *
   * @type {TestNatsUser | undefined}
   * @readonly
   */
  readonly natsUser?: TestNatsUser;

  /**
   * Property streams
   *
   * @description
   * JetStream streams to create besides `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ`.
   *
   * @type {readonly TestStream[] | undefined}
   * @readonly
   */
  readonly streams?: readonly TestStream[];

  /**
   * Property issuers
   *
   * @description
   * Services allowed to call the one under test; tokens are signed by the first. Defaults to
   * `api-gateway` alone.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly issuers?: readonly string[];

  /**
   * Property env
   *
   * @description
   * Further environment variables, or a function that derives them from the started
   * dependencies. They replace the default ones of the same name.
   *
   * @type {TestEnvironment | ((infrastructure: TestInfrastructure) => TestEnvironment) | undefined}
   * @readonly
   */
  readonly env?: TestEnvironment | ((infrastructure: TestInfrastructure) => TestEnvironment);

  /**
   * Property http
   *
   * @description
   * Initial handlers of the third-party fakes, built with `http` of this package.
   *
   * @type {readonly AnyHandler[] | undefined}
   * @readonly
   */
  readonly http?: readonly AnyHandler[];

  /**
   * Property allowHosts
   *
   * @description
   * Host names left reachable for real besides the loopback ones.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly allowHosts?: readonly string[];
  // #endregion
}

/**
 * Interface TestApp
 *
 * @description
 * An application under test with its disposable dependencies.
 *
 * @template TApp Type of the application under test.
 */
export interface TestApp<TApp extends TestApplication> extends TestInfrastructure {
  // #region Properties
  /**
   * Property app
   *
   * @description
   * The application, initialized and not listening: call it through `app.getHttpServer()`.
   *
   * @type {TApp}
   * @readonly
   */
  readonly app: TApp;
  // #endregion

  // #region Methods
  /**
   * Method close
   *
   * @description
   * Closes the application, stops the recorder and the fakes, restores `process.env` and
   * removes the containers. Every step runs even when an earlier one fails.
   *
   * @returns {Promise<void>} Resolves once everything is closed.
   * @throws {AggregateError} When one or more steps failed, after all of them ran.
   */
  close(): Promise<void>;
  // #endregion
}

/**
 * Type Stoppable
 *
 * @description
 * One started dependency and how to stop it.
 *
 * @type {() => Promise<void> | void}
 */
type Stoppable = () => Promise<void> | void;

/**
 * Function stopAll
 *
 * @description
 * Runs every step in order, whatever fails, and throws the failures together.
 *
 * @param {readonly Stoppable[]} steps - Steps to run.
 * @returns {Promise<void>} Resolves when every step succeeded.
 * @throws {AggregateError} When one or more steps failed.
 */
async function stopAll(steps: readonly Stoppable[]): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'The test application did not close cleanly.');
  }
}

/**
 * Function required
 *
 * @description
 * Returns a dependency, or explains which option starts it.
 *
 * @param {TValue | undefined} value - The dependency, when it was started.
 * @param {string} hint - What to say when it was not.
 * @returns {TValue} The dependency.
 * @throws {Error} When the dependency was not started.
 */
function required<TValue>(value: TValue | undefined, hint: string): TValue {
  if (value === undefined) {
    throw new Error(hint);
  }
  return value;
}

/**
 * Function applyEnvironment
 *
 * @description
 * Sets variables on `process.env` and returns how to put the previous values back.
 *
 * @param {TestEnvironment} env - Variables to set.
 * @returns {() => void} Restores the previous values.
 */
function applyEnvironment(env: TestEnvironment): () => void {
  const previous: Map<string, string | undefined> = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(env)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  return (): void => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

/**
 * Function createTestApp
 *
 * @description
 * Starts the disposable dependencies of a service or gateway, applies its migrations, then
 * builds and initializes the application:
 *
 * 1. PostgreSQL with the migrator and application roles, NATS with JetStream, the user of the
 *    application and the streams of cadenway-ops, and Redis when asked, each in its own
 *    container;
 * 2. the migrations, as the migrator role;
 * 3. an event recorder on `EVENTS`, as the NATS `admin` user, and the third-party fakes;
 * 4. the environment (`DATABASE_URL` of the application role, `MIGRATION_DATABASE_URL` of the
 *    migrator, `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`, `REDIS_URL`, the internal token
 *    variables, `NODE_ENV`, `LOG_LEVEL`, `PORT`) on `process.env`;
 * 5. the application, through `create`, then `init`.
 *
 * Nothing starts before the call. When a step fails, what already started is stopped and the
 * error is thrown. Call `close` in `afterAll`.
 *
 * @template TApp Type of the application under test.
 * @param {CreateTestAppOptions<TApp>} options - Service name, dependencies and application factory.
 * @returns {Promise<TestApp<TApp>>} The application and its dependencies.
 */
export async function createTestApp<TApp extends TestApplication>(
  options: CreateTestAppOptions<TApp>,
): Promise<TestApp<TApp>> {
  const stops: Stoppable[] = [];
  /**
   * Function unwind
   *
   * @description
   * Stops what started, most recent first.
   *
   * @returns {Promise<void>} Resolves once everything is stopped.
   */
  const unwind = (): Promise<void> => stopAll(stops.splice(0).reverse());
  try {
    const tokens: TestInternalTokens = createTestInternalTokens({
      audience: options.service,
      ...(options.issuers === undefined ? {} : { issuers: options.issuers }),
    });
    const natsUser: TestNatsUser = options.natsUser ?? { name: natsUserNameOf(options.service) };
    if (options.nats !== false) {
      // An unknown backend without a grant fails here, before any container starts.
      grantOf(natsUser);
    }
    const started: [
      PromiseSettledResult<TestDatabase | undefined>,
      PromiseSettledResult<TestNats | undefined>,
      PromiseSettledResult<TestRedis | undefined>,
    ] = await Promise.allSettled([
      options.postgres === false ? undefined : startTestDatabase({ service: options.service }),
      options.nats === false
        ? undefined
        : startTestNats({
            user: natsUser,
            ...(options.streams === undefined ? {} : { streams: options.streams }),
          }),
      options.redis === true ? startTestRedis() : undefined,
    ]);
    for (const result of started) {
      if (result.status === 'fulfilled' && result.value !== undefined) {
        stops.push(result.value.stop);
      }
    }
    for (const result of started) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }
    const [databaseResult, natsResult, redisResult] = started;
    const database: TestDatabase | undefined =
      databaseResult.status === 'fulfilled' ? databaseResult.value : undefined;
    const nats: TestNats | undefined =
      natsResult.status === 'fulfilled' ? natsResult.value : undefined;
    const redis: TestRedis | undefined =
      redisResult.status === 'fulfilled' ? redisResult.value : undefined;

    if (database !== undefined) {
      if (options.migrationsFolder !== undefined) {
        await database.migrate(options.migrationsFolder);
      }
      await options.migrate?.(database);
    } else if (options.migrationsFolder !== undefined || options.migrate !== undefined) {
      throw new Error('Migrations need PostgreSQL: remove "postgres: false".');
    }
    const events: EventRecorder | undefined = await nats?.recordEvents();
    const http: HttpFakes = startHttpFakes(options.http ?? [], {
      // The containers do not speak HTTP: their sockets stay out of the interception.
      tcpAddresses: [database?.appUrl, nats?.url, redis?.url].filter(
        (address: string | undefined): address is string => address !== undefined,
      ),
      ...(options.allowHosts === undefined ? {} : { allowHosts: options.allowHosts }),
    });
    stops.push(http.close);

    let env: TestEnvironment = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '3000',
      ...tokens.verifierEnv,
      ...(database === undefined
        ? {}
        : { DATABASE_URL: database.appUrl, MIGRATION_DATABASE_URL: database.migratorUrl }),
      ...(nats === undefined
        ? {}
        : { NATS_URL: nats.url, NATS_USER: nats.user.user, NATS_PASSWORD: nats.user.password }),
      ...(redis === undefined ? {} : { REDIS_URL: redis.url }),
    };
    const infrastructure: TestInfrastructure = {
      get env(): TestEnvironment {
        return env;
      },
      get database(): TestDatabase {
        return required(database, 'No PostgreSQL: createTestApp was called with postgres: false.');
      },
      get nats(): TestNats {
        return required(nats, 'No NATS: createTestApp was called with nats: false.');
      },
      get events(): EventRecorder {
        return required(events, 'No event recorder: createTestApp was called with nats: false.');
      },
      get redis(): TestRedis {
        return required(redis, 'No Redis: call createTestApp with redis: true.');
      },
      tokens,
      http,
    };
    const extra: TestEnvironment =
      typeof options.env === 'function' ? options.env(infrastructure) : (options.env ?? {});
    env = Object.freeze({ ...env, ...extra });
    stops.push(applyEnvironment(env));

    const app: TApp = await options.create(infrastructure);
    stops.push(async (): Promise<void> => {
      await app.close();
    });
    await app.init();

    const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(infrastructure);
    return Object.defineProperties({ app, close: unwind }, descriptors) as TestApp<TApp>;
  } catch (error) {
    try {
      await unwind();
    } catch {
      // The first failure is the one to report; what could not be stopped is disposable.
    }
    throw error;
  }
}
