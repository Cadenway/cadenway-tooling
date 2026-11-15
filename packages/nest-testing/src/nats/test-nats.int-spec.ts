import { jetstreamManager, type JetStreamManager, type StreamInfo } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fixtures } from '../fixtures/fixtures.js';
import { startHttpFakes, type HttpFakes } from '../http/http-fakes.js';
import type { EventRecorder, RecordedEvent } from './event-recorder.js';
import { startTestNats, type TestNats } from './test-nats.js';

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
    nats = await startTestNats({ streams: [{ name: 'EVENTS_DLQ', subjects: ['dlq.>'] }] });
    recorder = await nats.recordEvents();
    // NATS_URL alone, as a deployed service connects: the server asks for no credentials.
    connection = await connect({ servers: nats.url });
    manager = await jetstreamManager(connection);
  });

  beforeEach(async () => {
    await recorder.clear();
  });

  afterAll(async () => {
    await connection.close();
    await nats.stop();
  });

  it('switches JetStream on and creates the EVENTS stream on evt.>', async () => {
    const info: StreamInfo = await manager.streams.info('EVENTS');

    expect(info.config.subjects).toEqual(['evt.>']);
    expect(info.config.storage).toBe('file');
    // Seven days, in nanoseconds.
    expect(info.config.max_age).toBe(7 * 24 * 60 * 60 * 1e9);
  });

  it('creates the further streams it is asked for', async () => {
    const info: StreamInfo = await manager.streams.info('EVENTS_DLQ');

    expect(info.config.subjects).toEqual(['dlq.>']);
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
      const during: NatsConnection = await connect({ servers: nats.url, timeout: 5000 });
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
    await expect(connect({ servers: nats.url, timeout: 2000 })).rejects.toThrow();
  });
});
