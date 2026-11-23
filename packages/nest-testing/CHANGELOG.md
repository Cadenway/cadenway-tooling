# @cadenway/nest-testing

## 0.7.0

### Minor Changes

- 1520db8: Add the mockup fixtures to the root entry point: `fixtures.atelierNord()` (Atelier Nord with Camille Martin, Inès Robert, Hugo Dubois and Léa Petit), `fixtures.cooperativeLumen()` (a second organization for isolation tests), `fixtures.sprint14()` (the space Produit, Sprint 14, its statuses and its hand-written tasks, `CAD-482` among them), `fixtures.statuses()` and `fixtureId()`.

  The fixture types are inferred from the mockup data and can be used without installing a contracts package.

- e39bbee: Add the `@cadenway/nest-testing/infrastructure` entry point for integration tests.

  - `createTestApp({ service, create, tokenFactories, migrationsFolder })` starts disposable PostgreSQL, NATS with JetStream and, for a gateway, Redis through Testcontainers, on the image tags cadenway-ops pins (`POSTGRES_IMAGE`, `NATS_IMAGE`, `REDIS_IMAGE`). It applies the Drizzle migrations as the migrator role, sets `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`, `REDIS_URL` and the internal token variables, then builds and initializes the application. It returns the application with `database`, `nats`, `events`, `redis`, `tokens`, `http` and `close`. Nothing starts at import time.
  - `startTestDatabase` creates the database and the two roles of a service as cadenway-ops does: `<database>_migrator` owns the database and runs the DDL; `<database>_app` reads and writes the rows of `public` only, creates nothing, does not bypass row-level security and carries the deployed timeouts. Another schema, the `drizzle` journal of the migrations included, is closed to it unless its creator grants access. `asOrganization` and `asSystem` run work as the application role with `app.organization_id` or `app.system_access` set for the transaction.
  - `assertTenantIsolation`, `checkTenantIsolation` and `findUnprotectedTables` prove that row-level security is enabled, forced and effective between two organizations.
  - `startTestNats` authenticates its clients as the deployed broker of cadenway-ops does: an `admin` user, and the user of the application under test (`task` for task-service), held to the subjects of its own entities and to the inbox prefix `_INBOX.<user>`, with the grant cadenway-ops gives that backend or an explicit `grant`. As `admin`, it creates `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ` as `ensure-streams.sh` declares them. `createTestApp` sets `NATS_USER` and `NATS_PASSWORD` for the service (`natsUser` overrides the user); its event recorder (`waitFor`, `named`, `sync`, `clear`) reads as `admin` what the application really published.
  - `createTestInternalTokens` generates Ed25519 keys for the run and signs and verifies internal tokens with `@cadenway/nest-common`.
  - `startHttpFakes` and the re-exported `http`, `HttpResponse`, `delay` and `passthrough` of `msw` fake third-party HTTP: a request no handler answers fails instead of reaching the network.

  The caller supplies the signer and verifier factories from its installed Service Kit, so Tooling
  can reuse real authentication without a private runtime dependency. `@nats-io/jetstream` and
  `@nats-io/transport-node` become dependencies. `@testcontainers/nats` is no longer needed.

## 0.6.0

### Minor Changes

- e62f3d6: Support additional Nest module wiring under `composition/modules/<name>.module.ts`. The file
  exports one local, named, non-global Nest module and must list its authorized consumers in the
  owning `MODULE.md`. Its provider exports and runtime dependencies are subject to the same public
  contract and cycle checks as the main capability module.

### Patch Changes

- cc0811a: Reject additional Nest module files that declare a global module, including a private module
  imported by the exported module. Check that providers exported only through auxiliary wiring are
  available to every consumer declared for the corresponding public operation.

## 0.5.2

### Patch Changes

- d4fc211: Allow a standalone named import of the Service Kit's `Idempotent` decorator in service HTTP presentation. Other database imports remain subject to the existing architecture rules.

## 0.5.1

### Patch Changes

- 3570682: Allow the optional `@cadenway/nest-messaging` peer at version 0.2 while retaining support for 0.0.1.

## 0.5.0

### Minor Changes

- ca8f686: Check that strict kit exports use the declared outbox and jobs namespaces and
  enforce the isolation of those runtime components. In strict services and
  gateways, require imports of Service Kit packages to use published entries.

  Recognize the PostgreSQL event deduplication entry, require its public index as the export
  target, and keep event delivery and outbox publication independent of the PostgreSQL adapter.

## 0.4.0

### Minor Changes

- 428cd00: Add an opt-in strict Service Kit profile to the architecture verifier. Validate package exports,
  dependency direction, private imports, and test leaks without building the kit. Check the runtime
  boundaries for database request context and durable jobs, and retain the diagnostics and entry
  points of the existing profiles.

## 0.3.0

### Minor Changes

- e74a5d0: Enforce filename-derived exports for authored use cases, application inputs and outputs, outbound
  ports and DTOs in strict mode. Require a public instance `execute` method on use cases and reject
  generic utility paths. Use `tests/` for cross-layer integration sources in strict mode. The legacy
  convention also recognizes `tests/` and continues accepting `test/`.

## 0.2.0

### Minor Changes

- c0fee3e: Add an opt-in strict hexagonal architecture convention for NestJS services and gateways. Check
  capability ownership, contract placement, dependency direction and the types and providers that
  cross a module's public boundary. Existing profiles keep their behavior when strict mode is omitted.
  Both strict profiles use `src/modules/<module>/` and require HTTP controllers to depend on a local
  use case. The gateway profile retains its restrictions on business persistence.

## 0.1.1

### Patch Changes

- 9f9fdc6: Accept `src/telemetry.ts` at the top of `src/` in the `service` profile of `@cadenway/nest-testing/architecture`, beside `src/main.ts` and `src/migrate.ts`: it is the entry point `@cadenway/nest-common` prescribes, preloaded with `node --import ./dist/telemetry.js`. The `gateway` profile already accepted it and still does; the profiles are otherwise unchanged.

  A service that declared an exception for it (`{ file: 'src/telemetry.ts', rule: 'service-layout' }`) removes that exception when it upgrades: the verifier rejects it as stale.

## 0.1.0

### Minor Changes

- bed8c45: Add an architecture verifier for NestJS services, gateways, and the shared service kit.

## 0.0.1

### Patch Changes

- c45eb2b: Declare the third-party dependencies of the kit and add the `@cadenway/nest-jobs` package shell.

  - `nest-common`: `nestjs-pino`, `jose`, `cockatiel` and the OpenTelemetry SDK (traces and metrics over OTLP/HTTP); `zod` and `@opentelemetry/api` are peers.
  - `nest-messaging`: the NATS client (`@nats-io/transport-node`, `@nats-io/jetstream`); `drizzle-orm` and `pg` are optional peers, so a gateway without a database can consume events.
  - `nest-testing`: `testcontainers` with its PostgreSQL, NATS and Redis modules, and `msw`.
  - `nest-jobs`: `pg-boss`.

  No public API changes: the packages export what they exported before.

- Updated dependencies [c45eb2b]
  - @cadenway/nest-messaging@0.0.1
