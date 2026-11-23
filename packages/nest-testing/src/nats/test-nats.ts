import {
  DiscardPolicy,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
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
import {
  ADMIN_USER,
  credentialsOf,
  EVENTS_DLQ_STREAM,
  EVENTS_RESTRICTED_STREAM,
  EVENTS_STREAM,
  grantOf,
  permissionsOf,
  serverConfiguration,
  type NatsPermissions,
  type TestNatsCredentials,
  type TestNatsUser,
} from './nats-users.js';

export { EVENTS_DLQ_STREAM, EVENTS_RESTRICTED_STREAM, EVENTS_STREAM } from './nats-users.js';

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
 * Constant CONFIG_PATH
 *
 * @description
 * Where the configuration of the broker is copied in the container: the path cadenway-ops mounts
 * it at.
 *
 * @type {string}
 */
const CONFIG_PATH: string = '/etc/nats/nats-server.conf';

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
 * Constant DAY_MS
 *
 * @description
 * One day, in milliseconds.
 *
 * @type {number}
 */
const DAY_MS: number = 24 * 60 * 60 * 1000;

/**
 * Constant MIB
 *
 * @description
 * One mebibyte, in bytes.
 *
 * @type {number}
 */
const MIB: number = 1024 * 1024;

/**
 * Interface TestStream
 *
 * @description
 * A JetStream stream to create on the disposable server.
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
 * Interface DeclaredStream
 *
 * @description
 * A stream of cadenway-ops, with its retention.
 */
interface DeclaredStream extends TestStream {
  // #region Properties
  /**
   * Property maxAgeMs
   *
   * @description
   * How long a message is kept, in milliseconds.
   *
   * @type {number}
   * @readonly
   */
  readonly maxAgeMs: number;

  /**
   * Property maxBytes
   *
   * @description
   * Size cap of the stream, in bytes.
   *
   * @type {number}
   * @readonly
   */
  readonly maxBytes: number;

  /**
   * Property description
   *
   * @description
   * What the stream holds.
   *
   * @type {string}
   * @readonly
   */
  readonly description: string;
  // #endregion
}

/**
 * Constant DECLARED_STREAMS
 *
 * @description
 * The streams `compose/nats/ensure-streams.sh` of cadenway-ops declares, with the same subjects,
 * retention and caps.
 *
 * @type {readonly DeclaredStream[]}
 */
const DECLARED_STREAMS: readonly DeclaredStream[] = [
  {
    name: EVENTS_STREAM,
    subjects: [EVENTS_SUBJECTS],
    maxAgeMs: 7 * DAY_MS,
    maxBytes: 1024 * MIB,
    description: 'Every Cadenway event.',
  },
  {
    name: EVENTS_RESTRICTED_STREAM,
    subjects: ['restricted.>'],
    maxAgeMs: 7 * DAY_MS,
    maxBytes: 64 * MIB,
    description:
      'Identity events carrying a single-use code or link; read by notification-service only.',
  },
  {
    name: EVENTS_DLQ_STREAM,
    subjects: ['dlq.>'],
    maxAgeMs: 30 * DAY_MS,
    maxBytes: 256 * MIB,
    description: 'Messages a consumer gave up on, copied by the dead-letter worker.',
  },
];

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
   * Property user
   *
   * @description
   * NATS user of the application under test, such as `{ name: 'task' }`. It gets the permissions
   * cadenway-ops gives that backend, or `grant`. Without it, only the `admin` user exists.
   *
   * @type {TestNatsUser | undefined}
   * @readonly
   */
  readonly user?: TestNatsUser;

  /**
   * Property streams
   *
   * @description
   * Streams to create besides `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ`.
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
 * Disposable NATS server that authenticates its clients as the deployed one does: an `admin` user
 * that owns the streams, and the user of the application under test, held to its own subjects
 * and its own inbox prefix.
 */
export interface TestNats {
  // #region Properties
  /**
   * Property url
   *
   * @description
   * Address of the server: the `NATS_URL` of the application under test.
   *
   * @type {string}
   * @readonly
   */
  readonly url: string;

  /**
   * Property user
   *
   * @description
   * Credentials of the application under test: `NATS_USER`, `NATS_PASSWORD`, and the inbox prefix
   * its client must use. Reading it throws when no `user` was given.
   *
   * @type {TestNatsCredentials}
   * @readonly
   */
  readonly user: TestNatsCredentials;

  /**
   * Property permissions
   *
   * @description
   * Subjects the user of the application under test may publish to and subscribe to. Reading it
   * throws when no `user` was given.
   *
   * @type {NatsPermissions}
   * @readonly
   */
  readonly permissions: NatsPermissions;

  /**
   * Property admin
   *
   * @description
   * Credentials of the `admin` user, which may do everything: the streams, the recorder and
   * `publish` use it.
   *
   * @type {TestNatsCredentials}
   * @readonly
   */
  readonly admin: TestNatsCredentials;
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
   * Starts a recorder that reads the `EVENTS` stream from its first message, as the `admin` user.
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
 * Starts a disposable NATS server configured as cadenway-ops configures the deployed one
 * (`docs/messaging.md`): JetStream on, no anonymous client, an `admin` user, and the user of the
 * application under test with the permissions of its backend. As the `admin` user, it then
 * creates `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ` the way `ensure-streams.sh` does, and the
 * further streams asked for. Nothing starts before this call, and `stop` removes everything.
 *
 * @param {TestNatsOptions} options - Image, user of the application and further streams.
 * @returns {Promise<TestNats>} The running server.
 * @throws {Error} When the user is not a Cadenway backend and no grant is given.
 */
export async function startTestNats(options: TestNatsOptions = {}): Promise<TestNats> {
  const admin: TestNatsCredentials = credentialsOf(ADMIN_USER);
  const user: { credentials: TestNatsCredentials; permissions: NatsPermissions } | undefined =
    options.user === undefined
      ? undefined
      : {
          credentials: credentialsOf(options.user.name),
          permissions: permissionsOf(options.user.name, grantOf(options.user)),
        };
  const container: StartedTestContainer = await new GenericContainer(options.image ?? NATS_IMAGE)
    .withCopyContentToContainer([
      { content: serverConfiguration(admin, user), target: CONFIG_PATH, mode: 0o444 },
    ])
    .withCommand(['--config', CONFIG_PATH])
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
    const opened: NatsConnection = await connect({
      servers,
      user: admin.user,
      pass: admin.password,
      inboxPrefix: admin.inboxPrefix,
      name: 'cadenway-nest-testing',
    });
    connection = opened;
    const manager: JetStreamManager = await jetstreamManager(opened);
    for (const stream of DECLARED_STREAMS) {
      await manager.streams.add({
        name: stream.name,
        subjects: [...stream.subjects],
        description: stream.description,
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        discard: DiscardPolicy.Old,
        num_replicas: 1,
        max_age: nanos(stream.maxAgeMs),
        max_bytes: stream.maxBytes,
        duplicate_window: nanos(2 * 60 * 1000),
      });
    }
    for (const stream of options.streams ?? []) {
      await manager.streams.add({
        name: stream.name,
        subjects: [...stream.subjects],
        storage: StorageType.File,
      });
    }
    const client: JetStreamClient = jetstream(opened);
    return {
      url: `nats://${servers}`,
      get user(): TestNatsCredentials {
        if (user === undefined) {
          throw new Error('No NATS user: call startTestNats with user: { name }.');
        }
        return user.credentials;
      },
      get permissions(): NatsPermissions {
        if (user === undefined) {
          throw new Error('No NATS user: call startTestNats with user: { name }.');
        }
        return user.permissions;
      },
      admin,
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
