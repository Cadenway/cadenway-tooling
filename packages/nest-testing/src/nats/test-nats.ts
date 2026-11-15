import {
  jetstream,
  jetstreamManager,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
} from '@nats-io/jetstream';
import {
  connect,
  headers as createHeaders,
  nanos,
  type MsgHdrs,
  type NatsConnection,
} from '@nats-io/transport-node';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { NATS_IMAGE } from '../containers/images.js';
import { EVENT_SUBJECT_PREFIX, startEventRecorder, type EventRecorder } from './event-recorder.js';

/**
 * Constant CLIENT_PORT
 *
 * @description
 * Port of the NATS client protocol inside the container.
 *
 * @type {number}
 */
const CLIENT_PORT: number = 4222;

/**
 * Constant NATS_COMMAND
 *
 * @description
 * Arguments of the server: the command cadenway-ops gives NATS in `compose/infra.yaml`, so the
 * disposable server behaves as the deployed one. JetStream is on, and no client authenticates:
 * a service connects with `NATS_URL` alone.
 *
 * @type {readonly string[]}
 */
const NATS_COMMAND: readonly string[] = [
  '--jetstream',
  '--store_dir',
  '/data',
  '--http_port',
  '8222',
];

/**
 * Constant EVENTS_STREAM
 *
 * @description
 * Name of the single stream that holds every Cadenway event.
 *
 * @type {string}
 */
export const EVENTS_STREAM: string = 'EVENTS';

/**
 * Constant EVENTS_SUBJECTS
 *
 * @description
 * Subjects of the events stream.
 *
 * @type {string}
 */
export const EVENTS_SUBJECTS: string = `${EVENT_SUBJECT_PREFIX}>`;

/**
 * Constant EVENTS_MAX_AGE_MS
 *
 * @description
 * Retention of the events stream: seven days, as in production.
 *
 * @type {number}
 */
const EVENTS_MAX_AGE_MS: number = 7 * 24 * 60 * 60 * 1000;

/**
 * Interface TestStream
 *
 * @description
 * A further JetStream stream to create on the disposable server, such as the dead-letter stream
 * of the messaging tests.
 */
export interface TestStream {
  // #region Properties
  /**
   * Property name
   *
   * @description
   * Name of the stream.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property subjects
   *
   * @description
   * Subjects the stream stores.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly subjects: readonly string[];
  // #endregion
}

/**
 * Interface TestNatsOptions
 *
 * @description
 * Options of `startTestNats`.
 */
export interface TestNatsOptions {
  // #region Properties
  /**
   * Property image
   *
   * @description
   * NATS image. Defaults to `NATS_IMAGE`, the tag cadenway-ops pins.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly image?: string;

  /**
   * Property streams
   *
   * @description
   * Streams to create besides `EVENTS`.
   *
   * @type {readonly TestStream[] | undefined}
   * @readonly
   */
  readonly streams?: readonly TestStream[];
  // #endregion
}

/**
 * Interface PublishEventOptions
 *
 * @description
 * Options of `TestNats.publish`.
 */
export interface PublishEventOptions {
  // #region Properties
  /**
   * Property messageId
   *
   * @description
   * Value of `Nats-Msg-Id`. Defaults to the `id` of the payload when it has one, as the outbox
   * relay publishes. The server drops a second message with the same id inside its
   * deduplication window.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly messageId?: string;

  /**
   * Property headers
   *
   * @description
   * Further headers of the message, such as `traceparent`.
   *
   * @type {Readonly<Record<string, string>> | undefined}
   * @readonly
   */
  readonly headers?: Readonly<Record<string, string>>;
  // #endregion
}

/**
 * Interface TestNats
 *
 * @description
 * Disposable NATS server with JetStream switched on and the `EVENTS` stream created.
 */
export interface TestNats {
  // #region Properties
  /**
   * Property url
   *
   * @description
   * Address of the server: the `NATS_URL` of the application under test. As in the deployed
   * stack, the server asks for no credentials.
   *
   * @type {string}
   * @readonly
   */
  readonly url: string;
  // #endregion

  // #region Methods
  /**
   * Method publish
   *
   * @description
   * Publishes an event on `evt.<name>` as another service would, to test a handler. Resolves
   * once the stream stored the message.
   *
   * @param {string} name - Event name, such as `organization.deleted.v1`.
   * @param {unknown} payload - Payload, sent as JSON.
   * @param {PublishEventOptions} options - Message id and headers.
   * @returns {Promise<void>} Resolves once stored.
   */
  publish(name: string, payload: unknown, options?: PublishEventOptions): Promise<void>;

  /**
   * Method recordEvents
   *
   * @description
   * Starts a recorder that reads the `EVENTS` stream from its first message.
   *
   * @returns {Promise<EventRecorder>} The recorder; `stop` of the server stops it too.
   */
  recordEvents(): Promise<EventRecorder>;

  /**
   * Method stop
   *
   * @description
   * Stops the recorders, closes the connection and removes the container.
   *
   * @returns {Promise<void>} Resolves once stopped.
   */
  stop(): Promise<void>;
  // #endregion
}

/**
 * Function messageIdOf
 *
 * @description
 * Reads the event id a payload carries.
 *
 * @param {unknown} payload - Payload of an event.
 * @returns {string | undefined} Its `id` when it is a string.
 */
function messageIdOf(payload: unknown): string | undefined {
  if (typeof payload === 'object' && payload !== null && 'id' in payload) {
    return typeof payload.id === 'string' ? payload.id : undefined;
  }
  return undefined;
}

/**
 * Function startTestNats
 *
 * @description
 * Starts a disposable NATS server with the command cadenway-ops runs (JetStream on, no client
 * authentication) and creates the `EVENTS` stream on `evt.>`, with file storage and seven days of
 * retention as in production. Deployed, the streams are not the business of the test harness;
 * here the harness creates them. Nothing starts before this call, and `stop` removes everything.
 *
 * @param {TestNatsOptions} options - Image and further streams.
 * @returns {Promise<TestNats>} The running server.
 */
export async function startTestNats(options: TestNatsOptions = {}): Promise<TestNats> {
  const container: StartedTestContainer = await new GenericContainer(options.image ?? NATS_IMAGE)
    .withCommand([...NATS_COMMAND])
    .withExposedPorts(CLIENT_PORT)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/u))
    .withStartupTimeout(120_000)
    .start();
  let connection: NatsConnection | undefined;
  const recorders: EventRecorder[] = [];
  /**
   * Function stop
   *
   * @description
   * Stops the recorders and the connection, then removes the container whatever failed before.
   *
   * @returns {Promise<void>} Resolves once stopped.
   */
  const stop = async (): Promise<void> => {
    try {
      await Promise.all(
        recorders.splice(0).map((recorder: EventRecorder): Promise<void> => recorder.stop()),
      );
      await connection?.close();
    } finally {
      await container.stop();
    }
  };
  try {
    const servers: string = `${container.getHost()}:${String(container.getMappedPort(CLIENT_PORT))}`;
    const opened: NatsConnection = await connect({ servers, name: 'cadenway-nest-testing' });
    connection = opened;
    const manager: JetStreamManager = await jetstreamManager(opened);
    const streams: readonly TestStream[] = [
      { name: EVENTS_STREAM, subjects: [EVENTS_SUBJECTS] },
      ...(options.streams ?? []),
    ];
    for (const stream of streams) {
      await manager.streams.add({
        name: stream.name,
        subjects: [...stream.subjects],
        storage: StorageType.File,
        max_age: nanos(EVENTS_MAX_AGE_MS),
      });
    }
    const client: JetStreamClient = jetstream(opened);
    return {
      url: `nats://${servers}`,
      publish: async (
        name: string,
        payload: unknown,
        publishOptions: PublishEventOptions = {},
      ): Promise<void> => {
        if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/u.test(name)) {
          throw new Error('An event name is dot-separated tokens, such as "task.created.v1".');
        }
        const messageId: string | undefined = publishOptions.messageId ?? messageIdOf(payload);
        const messageHeaders: MsgHdrs = createHeaders();
        for (const [key, value] of Object.entries(publishOptions.headers ?? {})) {
          messageHeaders.set(key, value);
        }
        await client.publish(`${EVENT_SUBJECT_PREFIX}${name}`, JSON.stringify(payload), {
          headers: messageHeaders,
          ...(messageId === undefined ? {} : { msgID: messageId }),
        });
      },
      recordEvents: async (): Promise<EventRecorder> => {
        const recorder: EventRecorder = await startEventRecorder(opened, EVENTS_STREAM);
        recorders.push(recorder);
        return recorder;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
