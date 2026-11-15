import {
  jetstream,
  jetstreamManager,
  type Consumer,
  type ConsumerMessages,
  type JsMsg,
  type StreamInfo,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';

/**
 * Constant EVENT_SUBJECT_PREFIX
 *
 * @description
 * Prefix of the subject of every Cadenway event: `evt.<event-name>`.
 *
 * @type {string}
 */
export const EVENT_SUBJECT_PREFIX: string = 'evt.';

/**
 * Constant DEFAULT_WAIT_MS
 *
 * @description
 * How long `waitFor` and `sync` wait by default, in milliseconds.
 *
 * @type {number}
 */
const DEFAULT_WAIT_MS: number = 5000;

/**
 * Interface RecordedEvent
 *
 * @description
 * One message read from the events stream.
 *
 * @template TPayload Type of the decoded payload.
 */
export interface RecordedEvent<TPayload = unknown> {
  // #region Properties
  /**
   * Property name
   *
   * @description
   * Name of the event: the subject without its `evt.` prefix, such as
   * `task.status-changed.v1`.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property subject
   *
   * @description
   * Subject the message was published on.
   *
   * @type {string}
   * @readonly
   */
  readonly subject: string;

  /**
   * Property payload
   *
   * @description
   * Payload decoded from JSON; the raw text when the message is not JSON.
   *
   * @type {TPayload}
   * @readonly
   */
  readonly payload: TPayload;

  /**
   * Property headers
   *
   * @description
   * Headers of the message, with the first value of each. `Nats-Msg-Id` carries the event id.
   *
   * @type {Readonly<Record<string, string>>}
   * @readonly
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Property sequence
   *
   * @description
   * Sequence of the message in the stream: the order of publication.
   *
   * @type {number}
   * @readonly
   */
  readonly sequence: number;
  // #endregion
}

/**
 * Interface WaitForEventOptions
 *
 * @description
 * Options of `EventRecorder.waitFor`.
 *
 * @template TPayload Type of the decoded payload.
 */
export interface WaitForEventOptions<TPayload = unknown> {
  // #region Properties
  /**
   * Property where
   *
   * @description
   * Further condition on the event, for example on the id of its entity.
   *
   * @type {((event: RecordedEvent<TPayload>) => boolean) | undefined}
   * @readonly
   */
  readonly where?: (event: RecordedEvent<TPayload>) => boolean;

  /**
   * Property timeoutMs
   *
   * @description
   * How long to wait, in milliseconds. Defaults to 5000.
   *
   * @type {number | undefined}
   * @readonly
   */
  readonly timeoutMs?: number;
  // #endregion
}

/**
 * Interface EventRecorder
 *
 * @description
 * Records every message published on the events stream, straight from NATS JetStream, so a test
 * asserts on what the service really published.
 */
export interface EventRecorder {
  // #region Properties
  /**
   * Property events
   *
   * @description
   * Events recorded since the start or the last `clear`, in order of publication.
   *
   * @type {readonly RecordedEvent[]}
   * @readonly
   */
  readonly events: readonly RecordedEvent[];
  // #endregion

  // #region Methods
  /**
   * Method named
   *
   * @description
   * Returns the recorded events of one name.
   *
   * @template TPayload Type of the decoded payload.
   * @param {string} name - Event name, such as `task.created.v1`.
   * @returns {readonly RecordedEvent<TPayload>[]} The events, in order of publication.
   */
  named<TPayload = unknown>(name: string): readonly RecordedEvent<TPayload>[];

  /**
   * Method waitFor
   *
   * @description
   * Resolves with the first event of a name, already recorded or still to come. Events leave
   * the service after its transaction commits, so a test waits for them rather than reading
   * `events` at once.
   *
   * @template TPayload Type of the decoded payload.
   * @param {string} name - Event name, such as `task.created.v1`.
   * @param {WaitForEventOptions<TPayload>} options - Further condition and timeout.
   * @returns {Promise<RecordedEvent<TPayload>>} The event.
   * @throws {Error} When no such event arrives in time; the message lists what was recorded.
   */
  waitFor<TPayload = unknown>(
    name: string,
    options?: WaitForEventOptions<TPayload>,
  ): Promise<RecordedEvent<TPayload>>;

  /**
   * Method sync
   *
   * @description
   * Resolves once every message the stream holds at the time of the call is recorded. Use it
   * before asserting that an event was not published.
   *
   * @param {number} timeoutMs - How long to wait, in milliseconds. Defaults to 5000.
   * @returns {Promise<void>} Resolves once the recorder caught up.
   * @throws {Error} When the recorder does not catch up in time.
   */
  sync(timeoutMs?: number): Promise<void>;

  /**
   * Method clear
   *
   * @description
   * Forgets the recorded events, between two tests. Messages published before the call and not
   * read yet are dropped when they arrive.
   *
   * @returns {Promise<void>} Resolves once forgotten.
   */
  clear(): Promise<void>;

  /**
   * Method stop
   *
   * @description
   * Stops reading the stream.
   *
   * @returns {Promise<void>} Resolves once stopped.
   */
  stop(): Promise<void>;
  // #endregion
}

/**
 * Interface Waiter
 *
 * @description
 * A pending wait: notified on every recorded message until it settles.
 */
interface Waiter {
  // #region Methods
  /**
   * Method check
   *
   * @description
   * Looks at the recorder state and settles the wait when its condition holds.
   *
   * @returns {boolean} Whether the wait settled and can be forgotten.
   */
  check(): boolean;
  // #endregion
}

/**
 * Function decode
 *
 * @description
 * Turns a JetStream message into a recorded event.
 *
 * @param {JsMsg} message - Message read from the stream.
 * @returns {RecordedEvent} The event.
 */
function decode(message: JsMsg): RecordedEvent {
  const text: string = message.string();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    // Not JSON: the raw text is kept, so the test sees what was published.
  }
  const headers: Record<string, string> = {};
  if (message.headers !== undefined) {
    for (const key of message.headers.keys()) {
      headers[key] = message.headers.get(key);
    }
  }
  return Object.freeze({
    name: message.subject.startsWith(EVENT_SUBJECT_PREFIX)
      ? message.subject.slice(EVENT_SUBJECT_PREFIX.length)
      : message.subject,
    subject: message.subject,
    payload,
    headers: Object.freeze(headers),
    sequence: message.seq,
  });
}

/**
 * Function startEventRecorder
 *
 * @description
 * Starts recording a stream from its first message, through an ordered consumer that leaves
 * nothing behind on the server.
 *
 * @param {NatsConnection} connection - Open connection to the disposable server.
 * @param {string} stream - Name of the stream to read, `EVENTS` for the services.
 * @returns {Promise<EventRecorder>} The recorder, already reading.
 */
export async function startEventRecorder(
  connection: NatsConnection,
  stream: string,
): Promise<EventRecorder> {
  const consumer: Consumer = await jetstream(connection).consumers.get(stream);
  const messages: ConsumerMessages = await consumer.consume();
  let recorded: RecordedEvent[] = [];
  let lastSequence: number = 0;
  let ignoreUpTo: number = 0;
  let failure: Error | undefined;
  let stopped: boolean = false;
  const waiters: Set<Waiter> = new Set<Waiter>();
  /**
   * Function notify
   *
   * @description
   * Lets every pending wait look at the new state.
   *
   * @returns {void}
   */
  const notify = (): void => {
    for (const waiter of waiters) {
      if (waiter.check()) {
        waiters.delete(waiter);
      }
    }
  };
  /**
   * Function until
   *
   * @description
   * Resolves with the first non-undefined value a probe returns, now or after a later message.
   *
   * @param {() => TValue | undefined} probe - Reads the recorder state.
   * @param {number} timeoutMs - How long to wait.
   * @param {() => string} describe - Builds the message of the timeout error.
   * @returns {Promise<TValue>} The value.
   */
  const until = <TValue>(
    probe: () => TValue | undefined,
    timeoutMs: number,
    describe: () => string,
  ): Promise<TValue> =>
    new Promise<TValue>((resolve: (value: TValue) => void, reject: (error: Error) => void) => {
      let timer: NodeJS.Timeout | undefined;
      const waiter: Waiter = {
        check: (): boolean => {
          if (failure !== undefined) {
            clearTimeout(timer);
            reject(failure);
            return true;
          }
          const value: TValue | undefined = probe();
          if (value === undefined) {
            return false;
          }
          clearTimeout(timer);
          resolve(value);
          return true;
        },
      };
      if (waiter.check()) {
        return;
      }
      waiters.add(waiter);
      timer = setTimeout((): void => {
        waiters.delete(waiter);
        reject(new Error(describe()));
      }, timeoutMs);
    });
  const reading: Promise<void> = (async (): Promise<void> => {
    try {
      for await (const message of messages) {
        lastSequence = message.seq;
        if (message.seq > ignoreUpTo) {
          recorded.push(decode(message));
        }
        notify();
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    if (!stopped && failure === undefined) {
      failure = new Error(`The event recorder stopped reading the stream ${stream}.`);
    }
    notify();
  })();
  /**
   * Function sync
   *
   * @description
   * Waits until the recorder read the last message the stream holds now.
   *
   * @param {number} timeoutMs - How long to wait.
   * @returns {Promise<void>} Resolves once caught up.
   */
  const sync = async (timeoutMs: number = DEFAULT_WAIT_MS): Promise<void> => {
    const info: StreamInfo = await (await jetstreamManager(connection)).streams.info(stream);
    const target: number = info.state.last_seq;
    await until<true>(
      (): true | undefined => (lastSequence >= target ? true : undefined),
      timeoutMs,
      (): string =>
        `The event recorder read up to message ${String(lastSequence)} of ${String(target)} ` +
        `within ${String(timeoutMs)} ms.`,
    );
  };
  return {
    get events(): readonly RecordedEvent[] {
      return [...recorded];
    },
    named: <TPayload = unknown>(name: string): readonly RecordedEvent<TPayload>[] =>
      recorded.filter(
        (event: RecordedEvent): event is RecordedEvent<TPayload> => event.name === name,
      ),
    waitFor: <TPayload = unknown>(
      name: string,
      options: WaitForEventOptions<TPayload> = {},
    ): Promise<RecordedEvent<TPayload>> => {
      const timeoutMs: number = options.timeoutMs ?? DEFAULT_WAIT_MS;
      return until<RecordedEvent<TPayload>>(
        (): RecordedEvent<TPayload> | undefined =>
          recorded.find(
            (event: RecordedEvent): event is RecordedEvent<TPayload> =>
              event.name === name &&
              (options.where === undefined || options.where(event as RecordedEvent<TPayload>)),
          ),
        timeoutMs,
        (): string => {
          const names: string =
            recorded.map((event: RecordedEvent) => event.name).join(', ') || 'nothing';
          return `No event ${name} within ${String(timeoutMs)} ms. Recorded: ${names}.`;
        },
      );
    },
    sync,
    clear: async (): Promise<void> => {
      const info: StreamInfo = await (await jetstreamManager(connection)).streams.info(stream);
      ignoreUpTo = Math.max(ignoreUpTo, info.state.last_seq);
      recorded = recorded.filter((event: RecordedEvent) => event.sequence > ignoreUpTo);
    },
    stop: async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;
      await messages.close();
      await reading;
    },
  };
}
