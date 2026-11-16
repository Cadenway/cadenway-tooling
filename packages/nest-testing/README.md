# @cadenway/nest-testing

Test helpers for the Cadenway NestJS services and gateways.

The `@cadenway/nest-testing/architecture` subpath analyzes TypeScript using the consumer's
own tsconfig. It does not start NestJS, load application modules, or require containers.

```ts
import { verifyNestArchitecture } from '@cadenway/nest-testing/architecture';

const violations = verifyNestArchitecture({
  rootDir: process.cwd(),
  tsconfig: 'tsconfig.json',
  profile: 'service',
  convention: 'strict',
});
```

At the top of `src/`, a service holds only its process entry points (`main.ts`, `migrate.ts`, and
`telemetry.ts`, which `@cadenway/nest-common` preloads with `node --import ./dist/telemetry.js`),
`app.module.ts`, and `config/`, `health/` and `infrastructure/`. Anything else belongs to a module
under `src/modules/<module>/` (`service-layout`).

Use `service` for a business service, `gateway` for an HTTP or realtime gateway, and `kit` for the
service-kit workspace. Findings carry repository-relative `file`, one-based `line`, `rule` and
`message`.

For `service` and `gateway`, `convention: 'strict'` enables the V2 folder and dependency rules. It
requires all authored modules and capabilities to follow the convention, including existing ones.
Use `profile: 'gateway'` for both HTTP and realtime gateways. Both profiles identify capabilities
under `src/modules/<module>/`, require a module manifest and Nest composition root, and check
public entries against the owner's declared consumers, providers and use case signatures. HTTP
controllers depend on a use case even for one-to-one routes. The gateway profile still keeps SQL
and transactional outbox code in services, restricts generated clients to their technical
adapters, and supports explicitly published HTTP guards. Fixture tests run without starting Nest
or any infrastructure.

`<module>.module.ts` can declare tokens and factory providers inline. The optional
`composition/` directory holds wiring split into separate files. Strict verification accepts both.

Omit `convention` to keep the existing rules. In that mode, an exception names the exact `file` and
`rule` and states its `reason`. The verifier rejects stale exceptions. Strict mode rejects exceptions.

Adopt V2 after its package release. Update the released development dependency and set the
convention in the consumer's existing `test:architecture` suite. Keep dependency updates, lockfiles
and test activation in the consumer checkout. A strict suite with findings fails in CI.

## Fixtures

The root entry point gives the data of the mockup, so a failing test reads like the product:
Atelier Nord, Camille Martin, `CAD-482`.

```ts
import { fixtures } from '@cadenway/nest-testing';

const { organization, CM, IR, HD, LP } = fixtures.atelierNord();
const { space, sprint, tasks, task } = fixtures.sprint14();

task('CAD-482').assignees; // ['CM', 'IR']
```

| Fixture                       | Gives                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures.atelierNord()`      | The organization Atelier Nord and its people: Camille Martin (`CM`, owner), Inès Robert (`IR`, admin), Hugo Dubois (`HD`, admin), Léa Petit (`LP`, member); `members` lists them    |
| `fixtures.cooperativeLumen()` | A second organization, Coopérative Lumen, where Camille Martin is a member: for the tests of isolation between organizations                                                        |
| `fixtures.sprint14()`         | The space Produit (prefix `CAD`), the sprint (3 to 17 November 2026), the ten statuses, the fourteen tasks the mockup writes by hand and their seven subtasks; `task(id)` finds one |
| `fixtures.statuses()`         | The ten default statuses with their French labels and categories                                                                                                                    |
| `fixtureId(group, index)`     | The stable UUID of a fixture entity (`organization`, `user`, `space`, `list`, `task`), to give more rows an id in the same style                                                    |

- The fixtures are plain, frozen data. They hold no table and no rule: each service maps them to
  its own schema, and spreads an object to derive a variant.
- Task ids are the ids of the mockup and of the contracts (`CAD-482`). Every other id is a UUID
  written for the tests, shaped as UUID version 7, because the mockup gives none: a task also has
  one in `uuid`, ending with its number.
- Status, priority and recurrence keys are typed by the shared enumerations of
  `@cadenway/contracts`, an optional peer the services already install.
- Estimates are in minutes; the mockup writes `8 h`. Comments carry no timestamp, because the
  mockup dates them with relative words only.
- The tasks and subtasks the mockup generates in a loop to fill its lists (`CAD-500` and above)
  are left out.

## Integration tests

`createTestApp` starts the disposable dependencies of a service or gateway in Docker, applies its
migrations, then builds and initializes the application. Assert on the database and on the
recorded events, never on logs.

```ts
import { createTestApp, fixtures, type TestApp } from '@cadenway/nest-testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

let testApp: TestApp<NestExpressApplication>;

beforeAll(async () => {
  testApp = await createTestApp({
    service: 'task-service',
    migrationsFolder: 'migrations',
    // Imported here, not at the top: the configuration must see the test environment.
    create: async () => (await import('../src/app.js')).createTaskService(),
  });
});
afterEach(() => testApp.http.reset());
afterAll(() => testApp.close());

it('publishes the status change of CAD-482', async () => {
  const { organization, CM } = fixtures.atelierNord();

  await request(testApp.app.getHttpServer())
    .post('/internal/v1/tasks/CAD-482/status')
    .set(
      'Authorization',
      await testApp.tokens.authorization({
        actor: { type: 'user', id: CM.id },
        organizationId: organization.id,
      }),
    )
    .send({ status: 'review' })
    .expect(200);

  const event = await testApp.events.waitFor('task.status-changed.v1');
  expect(event.payload).toMatchObject({ organizationId: organization.id });
});
```

In order, `createTestApp`:

1. starts PostgreSQL with the two roles of the service, NATS with JetStream, the NATS user of the
   service and the streams of `cadenway-ops`, and Redis when asked, each in its own container;
2. applies the migrations as the migrator role, then `migrate` when given;
3. starts an event recorder on `EVENTS`, as the NATS `admin` user, and the third-party fakes;
4. sets the environment on `process.env`;
5. calls `create`, then `init` on what it returns. The application never listens: call it through
   `app.getHttpServer()`.

Nothing starts before the call. When a step fails, what already started is stopped and the error
is thrown. `close` closes the application, stops the recorder and the fakes, restores
`process.env` and removes the containers; every step runs even when an earlier one fails.

| Option             | Default           | Effect                                                                                 |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------- |
| `service`          | Required          | Names the database (`task-service` gives `task`) and its roles; audience of the tokens |
| `create`           | Required          | Builds the application, given the started dependencies                                 |
| `migrationsFolder` | None              | Drizzle migrations folder (holding `meta/_journal.json`), applied as the migrator      |
| `migrate`          | None              | Further preparation of the database after the migrations                               |
| `postgres`         | `true`            | `false` for a gateway                                                                  |
| `nats`             | `true`            | `false` when the application neither publishes nor consumes                            |
| `redis`            | `false`           | `true` for a gateway                                                                   |
| `natsUser`         | From `service`    | NATS user of the application: `{ name, grant }` (see [NATS users](#nats-users))        |
| `streams`          | None              | JetStream streams to create besides `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ`     |
| `issuers`          | `['api-gateway']` | Services allowed to call the one under test; tokens are signed by the first            |
| `env`              | None              | Further variables, or a function of the started dependencies; they win over the below  |
| `http`             | None              | Initial `msw` handlers of the third-party fakes                                        |
| `allowHosts`       | None              | Host names left reachable besides loopback, never a third party                        |

| Variable                                                    | Value                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                                              | The application role `<database>_app`                                 |
| `MIGRATION_DATABASE_URL`                                    | The migrator role `<database>_migrator`, which `src/migrate.ts` reads |
| `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`                    | The disposable NATS and the user of the service (`task`)              |
| `REDIS_URL`                                                 | The disposable Redis, with `redis: true`                              |
| `INTERNAL_TOKEN_AUDIENCE`, `INTERNAL_TOKEN_TRUSTED_ISSUERS` | The service name and the verification keys of the test issuers        |
| `NODE_ENV`, `LOG_LEVEL`, `PORT`                             | `test`, `silent`, `3000`                                              |

The result is the application (`app`) with `env`, `database`, `nats`, `events`, `redis`,
`tokens`, `http` and `close`. Reading a dependency that was not started throws and names the
option that starts it.

Docker must be running. A first run pulls the images: give the hooks of the integration project
three minutes (`hookTimeout: 180_000`).

### Database

`testApp.database`, or `startTestDatabase({ service })` on its own, creates the database and its
roles as `cadenway-ops` does ([`docs/database.md`](https://github.com/Cadenway/cadenway-ops/blob/main/docs/database.md)),
so a test runs with the privileges of the deployed service:

| Role                  | May                                                                                                                                                                                                                         | Timeouts (statement, lock, idle in transaction) |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `<database>_migrator` | Owns the database and runs the DDL                                                                                                                                                                                          | 15 min, 5 s, 60 s                               |
| `<database>_app`      | Connects, then reads and writes the rows of the tables and sequences the migrator creates in `public`; owns nothing, creates no schema, table or temporary table, is not a superuser and does not bypass row-level security | 10 s, 5 s, 30 s                                 |

Another schema the migrator creates stays closed to the application role unless the code that
creates it grants what the runtime needs, as `@cadenway/nest-jobs` does for `pgboss`. The journal of
the migrations, `drizzle.__drizzle_migrations`, is therefore out of its reach: a deleted journal row
would make the next migration run apply that migration again.

| Member                     | Gives                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `appUrl`, `migratorUrl`    | The connection strings of the two roles; the passwords are generated for each run            |
| `app`, `migrator`, `admin` | `pg` pools of the application role, the migrator and the superuser (to seed or inspect rows) |
| `migrate(folder)`          | Applies a Drizzle migrations folder as the migrator, adding nothing to it                    |
| `execute(statements)`      | Runs SQL as the migrator, for a test that owns its tables                                    |
| `asOrganization(id, work)` | Runs work as the application role in a transaction with `app.organization_id` set            |
| `asSystem(work)`           | Runs work as the application role in a transaction with `app.system_access = 'on'`           |
| `reset()`                  | Empties the tables of `public` and restarts their sequences; the migration history stays     |
| `roles`, `stop()`          | The role names; closing the pools and removing the container                                 |

The two transactions set their parameter with `SET LOCAL`, as the tenant and system transaction
runners of `@cadenway/nest-common/database` do (`ORGANIZATION_SETTING`, `SYSTEM_ACCESS_SETTING`).

### Tenant isolation

```ts
await assertTenantIsolation(testApp.database, {
  table: 'tasks',
  organizationId: fixtures.atelierNord().organization.id,
  otherOrganizationId: fixtures.cooperativeLumen().organization.id,
});
expect(await findUnprotectedTables(testApp.database)).toEqual([]);
```

`assertTenantIsolation` seeds nothing: insert at least one row of the first organization, through
`database.admin`, before the call. It checks, as the application role, that row-level security is
enabled and forced, that the role is held to it, that the organization reads all its rows, and that
another organization, or a transaction without one, reads none and changes none (the attempt rolls
back). It throws with every broken guarantee; `checkTenantIsolation` returns the same report
without throwing. `findUnprotectedTables` lists the tables of `public` with an `organization_id`
column whose row-level security is not enabled, not forced, or has no policy.

### Events

`testApp.events` reads the `EVENTS` stream from its first message, straight from JetStream, as the
`admin` user: it sees every event the service published with its own user.

| Member                                | Does                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `waitFor(name, { where, timeoutMs })` | Resolves with the first such event, recorded or still to come (5 s by default); the error lists what was recorded |
| `named(name)`, `events`               | The recorded events, in order of publication: `name`, `subject`, `payload`, `headers`, `sequence`                 |
| `sync(timeoutMs)`                     | Waits until everything the stream holds now is recorded: call it before asserting that nothing was published      |
| `clear()`                             | Forgets the recorded events, including those published and not read yet                                           |

`testApp.nats.publish(name, payload, { messageId, headers })` publishes on `evt.<name>` as another
service would, as the `admin` user, with `Nats-Msg-Id` taken from the `id` of the payload unless
`messageId` is given, to feed a handler.

### NATS users

The disposable broker authenticates as the deployed one does
([`docs/messaging.md`](https://github.com/Cadenway/cadenway-ops/blob/main/docs/messaging.md) of
`cadenway-ops`): no anonymous client, an `admin` user that creates the streams and that the
recorder reads with, and the user of the service under test. Passwords are generated for each run.

The user is named after the service (`task-service` gives `task`, `api-gateway` stays
`api-gateway`) and gets what `cadenway-ops` grants that backend:

- it publishes `evt.<entity>.>` and `rebuild.*.<entity>` for the entities it owns only: the task
  user publishing `evt.member.removed.v1` gets `Permissions Violation for Publish`;
- it reads the streams it consumes through JetStream consumers, and can neither create, change nor
  delete a stream;
- its client must use the inbox prefix `_INBOX.<user>` (`testApp.nats.user.inboxPrefix`): a client
  left on the default `_INBOX.>` is refused its first request.

| Backend                     | Entities it publishes                                            | Consumes                      |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| `identity`                  | `user`, `session`, `api-token`, and `restricted.>`               | `EVENTS`                      |
| `organization`              | `organization`, `member`, `domain`                               | `EVENTS`                      |
| `billing`                   | `subscription`, `quota`, `invoice`                               | `EVENTS`                      |
| `task`                      | `space`, `list`, `task`, `comment`, `approval`, `milestone`      | `EVENTS`                      |
| `document`, `storage`       | `doc`; `file`                                                    | `EVENTS`                      |
| `notification`              | `notification`, `reminder`, and `dlq.>` (the dead-letter worker) | `EVENTS`, `EVENTS_RESTRICTED` |
| `automation`, `integration` | `automation`; `git`                                              | `EVENTS`                      |
| `search`                    | nothing                                                          | `EVENTS`                      |
| `api-gateway`               | `api-usage`, without rebuilds                                    | nothing                       |
| `realtime-gateway`          | nothing                                                          | `EVENTS`                      |

Another user passes its grant: `natsUser: { name: 'reporting', grant: { entities: ['report'] } }`
(`consumes` defaults to `EVENTS`; `publishes`, `rebuilds` and `deadLetters` cover the exceptions
above). A grant that changes in `cadenway-ops` changes here with it.

`startTestNats({ user, streams })` runs the broker on its own. It creates `EVENTS` (`evt.>`, 7 days,
1 GiB), `EVENTS_RESTRICTED` (`restricted.>`, 7 days, 64 MiB) and `EVENTS_DLQ` (`dlq.>`, 30 days,
256 MiB) as `ensure-streams.sh` does: file storage, oldest messages dropped first, duplicates of a
`Nats-Msg-Id` refused for two minutes. `nats.user`, `nats.admin` and `nats.permissions` give the
credentials and the permissions of the run; `EVENTS_STREAM`, `EVENTS_RESTRICTED_STREAM`,
`EVENTS_DLQ_STREAM` and `EVENTS_SUBJECTS` name the streams.

### Internal tokens

`testApp.tokens`, or `createTestInternalTokens({ audience, issuers })` on its own, generates one
Ed25519 key per issuer for the run. Tokens are signed and verified by `@cadenway/nest-common`
itself.

| Member                                        | Gives                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `authorization(claims, { issuer, audience })` | `Bearer <token>`, valid 60 seconds; another `audience` gives a token the service must refuse                |
| `sign(claims, options)`                       | The token alone                                                                                             |
| `verify(token, audience)`                     | The principal of a token the application sent to a faked service                                            |
| `verifierEnv`, `trustedIssuers`               | What makes the service under test trust the issuers                                                         |
| `signerEnv(issuer)`                           | `INTERNAL_TOKEN_ISSUER` and `INTERNAL_TOKEN_PRIVATE_JWK`, for a gateway: `env: (i) => i.tokens.signerEnv()` |

`generateSigningJwk(kid)` and `publicJwkOf(jwk)` give a key pair for a spec of its own. No key is
ever written in a repository.

### Third-party HTTP

`testApp.http` fakes the HTTP systems the application calls (Stripe, GitHub, GitLab, identity
providers) with `msw`, for `fetch` and the `node:http` and `node:https` clients. A request no
handler answers fails with a network error and is listed in `unhandled`; only loopback addresses
stay reachable, so a test never reaches the network.

```ts
testApp.http.use(
  http.post('https://api.github.com/repos/:owner/:repo/hooks', () =>
    HttpResponse.json({ id: 1 }, { status: 201 }),
  ),
);
// ...
expect(testApp.http.unhandled).toEqual([]);
```

`http`, `HttpResponse`, `delay` and `passthrough` are re-exported from `msw`, so a service does
not depend on it. `use` adds handlers for the current test, `reset` removes them and forgets the
refused requests. `startHttpFakes(handlers, { tcpAddresses, allowHosts })` runs the fakes on
their own; `tcpAddresses` lists the non-HTTP dependencies, which `createTestApp` fills with its
containers.

### Containers

| Constant         | Image                  |
| ---------------- | ---------------------- |
| `POSTGRES_IMAGE` | `postgres:18.6-alpine` |
| `NATS_IMAGE`     | `nats:2.15.2-alpine`   |
| `REDIS_IMAGE`    | `redis:8.10.3-alpine`  |

The tags are those `cadenway-ops` pins in `compose/infra.yaml`; each `start*` function takes an
`image` option. A service never depends on `testcontainers` itself.

`pg` and `drizzle-orm` (the database helpers) and `@cadenway/nest-common` (the internal tokens)
are optional peers, loaded when first used. `@cadenway/nest-messaging` is an optional peer too
(`>=0.0.1 <1.0.0`): nothing here imports it, and the specs of this package run a sample service
on `MessagingModule` 0.1, connected with `NATS_USER`, `NATS_PASSWORD` and `_INBOX.<user>`.
