import {
  jetstream,
  jetstreamManager,
  type JetStreamManager,
  type StreamInfo,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fixtures } from '../fixtures/fixtures.js';
import { startHttpFakes, type HttpFakes } from '../http/http-fakes.js';
import type { EventRecorder, RecordedEvent } from './event-recorder.js';
import type { TestNatsCredentials } from './nats-users.js';
import { startTestNats, type TestNats } from './test-nats.js';

/**
 * Function connectAs
 *
 * @description
 * Connects to the disposable server as one of its users, on that user's inbox prefix, as
 * `@cadenway/nest-messaging` connects a service.
 *
 * @param {TestNats} nats - The server.
 * @param {TestNatsCredentials} credentials - User to connect as.
 * @returns {Promise<NatsConnection>} The connection.
 */
function connectAs(nats: TestNats, credentials: TestNatsCredentials): Promise<NatsConnection> {
  return connect({
    servers: nats.url,
    user: credentials.user,
    pass: credentials.password,
    inboxPrefix: credentials.inboxPrefix,
    timeout: 5000,
  });
}

/**
 * Interface StatusChanged
 *
 * @description
 * Payload of the event the specs publish, shaped as a Cadenway event envelope.
 */
interface StatusChanged {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the event.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property organizationId
   *
   * @description
   * Organization of the task.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property taskId
   *
   * @description
   * Id of the task.
   *
   * @type {string}
   * @readonly
   */
  readonly taskId: string;

  /**
   * Property status
   *
   * @description
   * New status.
   *
   * @type {string}
   * @readonly
   */
  readonly status: string;
  // #endregion
}

/**
 * Function statusChanged
 *
 * @description
 * Builds the payload of a status change of a Sprint 14 task.
 *
 * @param {string} id - Id of the event.
 * @param {string} taskId - Id of the task.
 * @param {string} status - New status.
 * @returns {StatusChanged} The payload.
 */
function statusChanged(id: string, taskId: string, status: string): StatusChanged {
  return { id, organizationId: fixtures.atelierNord().organization.id, taskId, status };
}

describe('startTestNats', () => {
  let nats: TestNats;
  let recorder: EventRecorder;
  let connection: NatsConnection;
  let manager: JetStreamManager;

  beforeAll(async () => {
    nats = await startTestNats({
      user: { name: 'task' },
      streams: [{ name: 'AUDIT', subjects: ['audit.>'] }],
    });
    recorder = await nats.recordEvents();
    connection = await connectAs(nats, nats.admin);
    manager = await jetstreamManager(connection);
  });

  beforeEach(async () => {
    await recorder.clear();
  });

  afterAll(async () => {
    await connection.close();
    await nats.stop();
  });

  it('creates EVENTS, EVENTS_RESTRICTED and EVENTS_DLQ as cadenway-ops declares them', async () => {
    const day: number = 24 * 60 * 60 * 1e9;
    const mib: number = 1024 * 1024;
    const declared: { name: string; subjects: string[]; days: number; bytes: number }[] = [
      { name: 'EVENTS', subjects: ['evt.>'], days: 7, bytes: 1024 * mib },
      { name: 'EVENTS_RESTRICTED', subjects: ['restricted.>'], days: 7, bytes: 64 * mib },
      { name: 'EVENTS_DLQ', subjects: ['dlq.>'], days: 30, bytes: 256 * mib },
    ];

    for (const stream of declared) {
      const info: StreamInfo = await manager.streams.info(stream.name);
      expect(info.config).toMatchObject({
        subjects: stream.subjects,
        storage: 'file',
        retention: 'limits',
        discard: 'old',
        num_replicas: 1,
        max_age: stream.days * day,
        max_bytes: stream.bytes,
        // Two minutes, in nanoseconds: the window the publishers rely on.
        duplicate_window: 120 * 1e9,
      });
    }
  });

  it('creates the further streams it is asked for', async () => {
    const info: StreamInfo = await manager.streams.info('AUDIT');

    expect(info.config.subjects).toEqual(['audit.>']);
  });

  it('refuses a client without credentials', async () => {
    await expect(connect({ servers: nats.url, timeout: 2000 })).rejects.toThrow(
      /Authorization Violation/iu,
    );
  });

  it('lets the service user publish the events of its entities, which the recorder reads', async () => {
    const service: NatsConnection = await connectAs(nats, nats.user);
    try {
      await jetstream(service).publish(
        'evt.task.status-changed.v1',
        JSON.stringify(statusChanged('evt-70', 'CAD-482', 'review')),
        { msgID: 'evt-70' },
      );
    } finally {
      await service.close();
    }

    const event: RecordedEvent<StatusChanged> =
      await recorder.waitFor<StatusChanged>('task.status-changed.v1');
    expect(event.headers['Nats-Msg-Id']).toBe('evt-70');
    expect(nats.user).toMatchObject({ user: 'task', inboxPrefix: '_INBOX.task' });
  });

  it('refuses the service user the subject of another backend', async () => {
    const service: NatsConnection = await connectAs(nats, nats.user);
    try {
      await expect(
        jetstream(service, { timeout: 2000 }).publish(
          'evt.organization.deleted.v1',
          JSON.stringify({ id: 'evt-71' }),
          { msgID: 'evt-71' },
        ),
      ).rejects.toThrow(/Permissions Violation for Publish to "evt\.organization\.deleted\.v1"/u);
    } finally {
      await service.close();
    }

    await recorder.sync();
    expect(recorder.named('organization.deleted.v1')).toEqual([]);
  });

  it('refuses the service user a client left on the default inbox prefix', async () => {
    const careless: NatsConnection = await connect({
      servers: nats.url,
      user: nats.user.user,
      pass: nats.user.password,
      timeout: 2000,
    });
    try {
      await expect(jetstreamManager(careless, { timeout: 2000 })).rejects.toThrow(
        /Permissions Violation for Subscription to "_INBOX\./u,
      );
    } finally {
      await careless.close();
    }
  });

  it('leaves the streams to the admin user', async () => {
    const service: NatsConnection = await connectAs(nats, nats.user);
    try {
      const serviceManager: JetStreamManager = await jetstreamManager(service, { timeout: 2000 });
      await expect(serviceManager.streams.delete('EVENTS')).rejects.toThrow(
        /Permissions Violation/u,
      );
      await expect(
        serviceManager.streams.add({ name: 'ROGUE', subjects: ['rogue.>'] }),
      ).rejects.toThrow(/Permissions Violation/u);
    } finally {
      await service.close();
    }

    expect((await manager.streams.info('EVENTS')).config.name).toBe('EVENTS');
  });

  it('records what is published, in order, with payload and headers', async () => {
    await nats.publish('task.status-changed.v1', statusChanged('evt-1', 'CAD-482', 'review'), {
      headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
    });
    await nats.publish('task.status-changed.v1', statusChanged('evt-2', 'CAD-479', 'done'));
    await nats.publish('task.created.v1', { id: 'evt-3', taskId: 'CAD-600' });
    await recorder.sync();

    expect(recorder.events.map((event: RecordedEvent) => event.name)).toEqual([
      'task.status-changed.v1',
      'task.status-changed.v1',
      'task.created.v1',
    ]);
    const first: RecordedEvent<StatusChanged> | undefined =
      recorder.named<StatusChanged>('task.status-changed.v1')[0];
    expect(first).toMatchObject({
      name: 'task.status-changed.v1',
      subject: 'evt.task.status-changed.v1',
      payload: statusChanged('evt-1', 'CAD-482', 'review'),
      headers: {
        'Nats-Msg-Id': 'evt-1',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      },
    });
    expect(recorder.named('task.created.v1')).toHaveLength(1);
    expect(recorder.named('task.trashed.v1')).toEqual([]);
  });

  it('waits for an event that is published later', async () => {
    const waiting: Promise<RecordedEvent<StatusChanged>> = recorder.waitFor<StatusChanged>(
      'task.status-changed.v1',
      { where: (event: RecordedEvent<StatusChanged>) => event.payload.taskId === 'CAD-482' },
    );
    await nats.publish('task.status-changed.v1', statusChanged('evt-10', 'CAD-479', 'done'));
    await nats.publish('task.status-changed.v1', statusChanged('evt-11', 'CAD-482', 'review'));

    expect((await waiting).payload).toEqual(statusChanged('evt-11', 'CAD-482', 'review'));
  });

  it('returns at once an event that is already recorded', async () => {
    await nats.publish('task.created.v1', { id: 'evt-20', taskId: 'CAD-601' });
    await recorder.sync();

    const event: RecordedEvent = await recorder.waitFor('task.created.v1', { timeoutMs: 1 });

    expect(event.headers['Nats-Msg-Id']).toBe('evt-20');
  });

  it('fails with what was recorded when the event does not come', async () => {
    await nats.publish('task.created.v1', { id: 'evt-30', taskId: 'CAD-602' });
    await recorder.sync();

    await expect(recorder.waitFor('task.trashed.v1', { timeoutMs: 200 })).rejects.toThrow(
      'No event task.trashed.v1 within 200 ms. Recorded: task.created.v1.',
    );
  });

  it('shows that the server drops a message published twice with the same id', async () => {
    await nats.publish('task.created.v1', { id: 'evt-40', taskId: 'CAD-603' });
    await nats.publish('task.created.v1', { id: 'evt-40', taskId: 'CAD-603' });
    await nats.publish('task.created.v1', { taskId: 'CAD-604' }, { messageId: 'evt-41' });
    await recorder.sync();

    expect(
      recorder.named('task.created.v1').map((event: RecordedEvent) => event.headers['Nats-Msg-Id']),
    ).toEqual(['evt-40', 'evt-41']);
  });

  it('forgets on clear, including what was published and not read yet', async () => {
    await nats.publish('task.created.v1', { id: 'evt-50', taskId: 'CAD-605' });
    await recorder.clear();
    await nats.publish('task.created.v1', { id: 'evt-51', taskId: 'CAD-606' });
    await recorder.sync();

    expect(recorder.events.map((event: RecordedEvent) => event.headers['Nats-Msg-Id'])).toEqual([
      'evt-51',
    ]);
  });

  it('keeps the text of a message that is not JSON', async () => {
    connection.publish('evt.legacy.raw.v1', 'not json');
    await connection.flush();

    expect((await recorder.waitFor('legacy.raw.v1')).payload).toBe('not json');
  });

  it('reads the stream from its first message when started later', async () => {
    await nats.publish('task.created.v1', { id: 'evt-60', taskId: 'CAD-607' });
    const late: EventRecorder = await nats.recordEvents();

    const event: RecordedEvent = await late.waitFor('task.created.v1', {
      where: (candidate: RecordedEvent) => candidate.headers['Nats-Msg-Id'] === 'evt-60',
    });

    expect(event.sequence).toBeGreaterThan(1);
    expect(late.events.length).toBeGreaterThan(recorder.events.length);
    await late.stop();
  });

  it('accepts a connection while the HTTP fakes run, once its address is declared', async () => {
    // Regression: msw holds a new socket until the client writes, and the NATS client waits
    // for the server to speak first. Without tcpAddresses this connection times out.
    const fakes: HttpFakes = startHttpFakes([], { tcpAddresses: [nats.url] });
    try {
      const during: NatsConnection = await connectAs(nats, nats.user);
      await during.flush();
      await during.close();
    } finally {
      fakes.close();
    }
  });

  it('refuses an event name that is not a subject suffix', async () => {
    await expect(nats.publish('task.*', {})).rejects.toThrow('An event name is dot-separated');
    await expect(nats.publish('', {})).rejects.toThrow('An event name is dot-separated');
  });
});

describe('TestNats.stop', () => {
  it('stops the recorders and removes the container: nothing answers afterwards', async () => {
    const nats: TestNats = await startTestNats();
    const recorder: EventRecorder = await nats.recordEvents();
    await nats.publish('task.created.v1', { id: 'evt-1' });
    await recorder.waitFor('task.created.v1');

    await nats.stop();

    await expect(recorder.sync(500)).rejects.toThrow();
    await expect(
      connect({
        servers: nats.url,
        user: nats.admin.user,
        pass: nats.admin.password,
        timeout: 2000,
      }),
    ).rejects.toThrow();
    // Started without a user: only the admin user exists, and asking for the other one says so.
    expect(() => nats.user).toThrow('No NATS user');
  });

  it('refuses a user that is not a Cadenway backend, before starting anything', async () => {
    await expect(startTestNats({ user: { name: 'reporting' } })).rejects.toThrow(
      'No NATS grant is known for the user "reporting"',
    );
  });
});
