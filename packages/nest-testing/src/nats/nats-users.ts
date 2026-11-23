import { randomBytes } from 'node:crypto';

/**
 * Constant EVENTS_STREAM
 *
 * @description
 * Name of the stream that holds every Cadenway event, on `evt.>`.
 *
 * @type {string}
 */
export const EVENTS_STREAM: string = 'EVENTS';

/**
 * Constant EVENTS_RESTRICTED_STREAM
 *
 * @description
 * Name of the stream of the restricted identity events, on `restricted.>`: read by
 * notification-service only.
 *
 * @type {string}
 */
export const EVENTS_RESTRICTED_STREAM: string = 'EVENTS_RESTRICTED';

/**
 * Constant EVENTS_DLQ_STREAM
 *
 * @description
 * Name of the stream of the dead letters, on `dlq.>`.
 *
 * @type {string}
 */
export const EVENTS_DLQ_STREAM: string = 'EVENTS_DLQ';

/**
 * Constant ADMIN_USER
 *
 * @description
 * NATS user that creates the streams and that the event recorder reads with, as the `admin` user
 * of cadenway-ops.
 *
 * @type {string}
 */
export const ADMIN_USER: string = 'admin';

/**
 * Interface TestNatsGrant
 *
 * @description
 * What a NATS user may do, in the terms of `docs/messaging.md` of cadenway-ops. The broker
 * permissions are derived from it the way `compose/nats/nats-server.conf` writes them.
 */
export interface TestNatsGrant {
  // #region Properties
  /**
   * Property entities
   *
   * @description
   * Entities whose events the user publishes: each gives `evt.<entity>.>` and, when the user
   * takes part in rebuilds, `rebuild.*.<entity>`.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly entities: readonly string[];

  /**
   * Property publishes
   *
   * @description
   * Further subjects the user publishes, such as `restricted.>` for identity-service.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly publishes?: readonly string[];

  /**
   * Property consumes
   *
   * @description
   * Streams the user reads through JetStream consumers. Defaults to `EVENTS`; empty for a user
   * that consumes nothing.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly consumes?: readonly string[];

  /**
   * Property rebuilds
   *
   * @description
   * Whether the user re-emits its entities for a rebuild and listens to `rebuild.<user>.>`.
   * Defaults to `true`; the gateways do not.
   *
   * @type {boolean | undefined}
   * @readonly
   */
  readonly rebuilds?: boolean;

  /**
   * Property deadLetters
   *
   * @description
   * Whether the user runs the dead-letter worker: it listens to the delivery advisories of the
   * streams it consumes, reads their messages by sequence and publishes on `dlq.>`. Defaults to
   * `false`; only notification-service does.
   *
   * @type {boolean | undefined}
   * @readonly
   */
  readonly deadLetters?: boolean;
  // #endregion
}

/**
 * Interface TestNatsUser
 *
 * @description
 * The NATS user of the application under test.
 */
export interface TestNatsUser {
  // #region Properties
  /**
   * Property name
   *
   * @description
   * Name of the user, as cadenway-ops names it: `task` for task-service, `api-gateway` for the
   * API gateway.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property grant
   *
   * @description
   * What the user may do. Defaults to what cadenway-ops grants the backend of that name; required
   * for any other name.
   *
   * @type {TestNatsGrant | undefined}
   * @readonly
   */
  readonly grant?: TestNatsGrant;
  // #endregion
}

/**
 * Interface TestNatsCredentials
 *
 * @description
 * What a client needs to connect as one user of the disposable server.
 */
export interface TestNatsCredentials {
  // #region Properties
  /**
   * Property user
   *
   * @description
   * Name of the user: the `NATS_USER` of a service.
   *
   * @type {string}
   * @readonly
   */
  readonly user: string;

  /**
   * Property password
   *
   * @description
   * Password of the user, generated for the run: the `NATS_PASSWORD` of a service.
   *
   * @type {string}
   * @readonly
   */
  readonly password: string;

  /**
   * Property inboxPrefix
   *
   * @description
   * Inbox prefix the client must use, `_INBOX.<user>`: the broker refuses the replies of any
   * other inbox.
   *
   * @type {string}
   * @readonly
   */
  readonly inboxPrefix: string;
  // #endregion
}

/**
 * Interface NatsPermissions
 *
 * @description
 * Subjects a user may publish to and subscribe to.
 */
export interface NatsPermissions {
  // #region Properties
  /**
   * Property publish
   *
   * @description
   * Subjects the user may publish to.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly publish: readonly string[];

  /**
   * Property subscribe
   *
   * @description
   * Subjects the user may subscribe to.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly subscribe: readonly string[];
  // #endregion
}

/**
 * Constant BACKEND_GRANTS
 *
 * @description
 * What cadenway-ops grants each backend (`docs/messaging.md`, table "Users"): the entities whose
 * events it publishes and the exceptions to the common shape. A backend absent from the table
 * passes its grant explicitly.
 *
 * @type {Readonly<Record<string, TestNatsGrant>>}
 */
const BACKEND_GRANTS: Readonly<Record<string, TestNatsGrant>> = Object.freeze({
  identity: { entities: ['user', 'session', 'api-token'], publishes: ['restricted.>'] },
  organization: { entities: ['organization', 'member', 'domain'] },
  billing: { entities: ['subscription', 'quota', 'invoice'] },
  task: { entities: ['space', 'list', 'task', 'comment', 'approval', 'milestone'] },
  document: { entities: ['doc'] },
  storage: { entities: ['file'] },
  notification: {
    entities: ['notification', 'reminder'],
    consumes: [EVENTS_STREAM, EVENTS_RESTRICTED_STREAM],
    deadLetters: true,
  },
  automation: { entities: ['automation'] },
  integration: { entities: ['git'] },
  search: { entities: [] },
  'api-gateway': { entities: ['api-usage'], consumes: [], rebuilds: false },
  'realtime-gateway': { entities: [], rebuilds: false },
});

/**
 * Function natsUserNameOf
 *
 * @description
 * Derives the NATS user of a service the way cadenway-ops names it: `task-service` gives `task`,
 * `api-gateway` stays `api-gateway`.
 *
 * @param {string} service - Name of the service, in lowercase kebab-case.
 * @returns {string} The user name.
 */
export function natsUserNameOf(service: string): string {
  return service.replace(/-service$/u, '');
}

/**
 * Function grantOf
 *
 * @description
 * Returns the grant of a user: the one given, or what cadenway-ops grants the backend of that
 * name.
 *
 * @param {TestNatsUser} user - User of the application under test.
 * @returns {TestNatsGrant} The grant.
 * @throws {Error} When the name is not a Cadenway backend and no grant is given.
 */
export function grantOf(user: TestNatsUser): TestNatsGrant {
  const grant: TestNatsGrant | undefined = user.grant ?? BACKEND_GRANTS[user.name];
  if (grant === undefined) {
    throw new Error(
      `No NATS grant is known for the user "${user.name}": pass its grant, the entities it ` +
        'publishes and the streams it consumes.',
    );
  }
  return grant;
}

/**
 * Function permissionsOf
 *
 * @description
 * Writes the broker permissions of a user as `compose/nats/nats-server.conf` of cadenway-ops does
 * for a backend: its own events and rebuilds, the JetStream API calls of the streams it reads
 * (never those that create, change or delete a stream), and its own inbox prefix only.
 *
 * @param {string} name - Name of the user.
 * @param {TestNatsGrant} grant - What the user may do.
 * @returns {NatsPermissions} The subjects it may publish to and subscribe to.
 */
export function permissionsOf(name: string, grant: TestNatsGrant): NatsPermissions {
  const consumes: readonly string[] = grant.consumes ?? [EVENTS_STREAM];
  const publishes: readonly string[] = grant.publishes ?? [];
  const rebuilds: boolean = grant.rebuilds ?? true;
  const deadLetters: boolean = grant.deadLetters ?? false;
  const restricted: boolean =
    publishes.includes('restricted.>') || consumes.includes(EVENTS_RESTRICTED_STREAM);
  const described: readonly string[] = [
    EVENTS_STREAM,
    ...(restricted ? [EVENTS_RESTRICTED_STREAM] : []),
    ...(deadLetters ? [EVENTS_DLQ_STREAM] : []),
  ];
  const publish: string[] = [
    ...grant.entities.map((entity: string): string => `evt.${entity}.>`),
    ...(rebuilds ? grant.entities.map((entity: string): string => `rebuild.*.${entity}`) : []),
    ...publishes,
    ...(deadLetters ? ['dlq.>'] : []),
    '$JS.API.INFO',
    '$JS.API.STREAM.NAMES',
    ...described.map((stream: string): string => `$JS.API.STREAM.INFO.${stream}`),
    ...(deadLetters
      ? consumes.map((stream: string): string => `$JS.API.STREAM.MSG.GET.${stream}`)
      : []),
    ...consumes.flatMap((stream: string): string[] => [
      `$JS.API.CONSUMER.CREATE.${stream}.>`,
      `$JS.API.CONSUMER.DURABLE.CREATE.${stream}.*`,
      `$JS.API.CONSUMER.INFO.${stream}.*`,
      `$JS.API.CONSUMER.MSG.NEXT.${stream}.*`,
      `$JS.ACK.${stream}.>`,
    ]),
  ];
  const subscribe: string[] = [
    `_INBOX.${name}.>`,
    ...(rebuilds ? [`rebuild.${name}.>`] : []),
    ...(deadLetters
      ? ['MAX_DELIVERIES', 'MSG_TERMINATED'].flatMap((advisory: string): string[] =>
          consumes.map(
            (stream: string): string => `$JS.EVENT.ADVISORY.CONSUMER.${advisory}.${stream}.>`,
          ),
        )
      : []),
  ];
  return { publish, subscribe };
}

/**
 * Function credentialsOf
 *
 * @description
 * Generates the credentials of one user for a run. The password is letters and digits starting
 * with a letter, the only shape the broker never misreads in its configuration.
 *
 * @param {string} user - Name of the user.
 * @returns {TestNatsCredentials} The credentials.
 */
export function credentialsOf(user: string): TestNatsCredentials {
  return Object.freeze({
    user,
    password: `p${randomBytes(18).toString('hex')}`,
    inboxPrefix: `_INBOX.${user}`,
  });
}

/**
 * Function serverConfiguration
 *
 * @description
 * Writes the configuration of the disposable broker: the ports and the JetStream storage of
 * cadenway-ops, the `admin` user, and the user of the application under test with its
 * permissions. Every value is a quoted string, so the broker reads no `$` as a variable.
 *
 * @param {TestNatsCredentials} admin - Credentials of the admin user.
 * @param {{ credentials: TestNatsCredentials; permissions: NatsPermissions } | undefined} user - User of the application under test.
 * @returns {string} The content of `nats-server.conf`.
 */
export function serverConfiguration(
  admin: TestNatsCredentials,
  user: { credentials: TestNatsCredentials; permissions: NatsPermissions } | undefined,
): string {
  const users: unknown[] = [
    {
      user: admin.user,
      password: admin.password,
      permissions: { publish: '>', subscribe: '>' },
    },
  ];
  if (user !== undefined) {
    users.push({
      user: user.credentials.user,
      password: user.credentials.password,
      permissions: {
        publish: { allow: user.permissions.publish },
        subscribe: { allow: user.permissions.subscribe },
      },
    });
  }
  return [
    'port: 4222',
    'http_port: 8222',
    'jetstream { store_dir: "/data" }',
    `authorization { users: ${JSON.stringify(users, undefined, 2)} }`,
    '',
  ].join('\n');
}
