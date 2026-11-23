---
'@cadenway/nest-testing': minor
---

Add the `@cadenway/nest-testing/infrastructure` entry point for integration tests.

- `createTestApp({ service, create, migrationsFolder })` starts disposable PostgreSQL, NATS with JetStream and, for a gateway, Redis through Testcontainers, on the image tags cadenway-ops pins (`POSTGRES_IMAGE`, `NATS_IMAGE`, `REDIS_IMAGE`). It applies the Drizzle migrations as the migrator role, sets `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`, `REDIS_URL` and the internal token variables, then builds and initializes the application. It returns the application with `database`, `nats`, `events`, `redis`, `tokens`, `http` and `close`. Nothing starts at import time.
- `startTestDatabase` creates the database and the two roles of a service as cadenway-ops does: `<database>_migrator` owns the database and runs the DDL; `<database>_app` reads and writes the rows of `public` only, creates nothing, does not bypass row-level security and carries the deployed timeouts. Another schema, the `drizzle` journal of the migrations included, is closed to it unless its creator grants access. `asOrganization` and `asSystem` run work as the application role with `app.organization_id` or `app.system_access` set for the transaction.
- `assertTenantIsolation`, `checkTenantIsolation` and `findUnprotectedTables` prove that row-level security is enabled, forced and effective between two organizations.
- `startTestNats` authenticates its clients as the deployed broker of cadenway-ops does: an `admin` user, and the user of the application under test (`task` for task-service), held to the subjects of its own entities and to the inbox prefix `_INBOX.<user>`, with the grant cadenway-ops gives that backend or an explicit `grant`. As `admin`, it creates `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ` as `ensure-streams.sh` declares them. `createTestApp` sets `NATS_USER` and `NATS_PASSWORD` for the service (`natsUser` overrides the user); its event recorder (`waitFor`, `named`, `sync`, `clear`) reads as `admin` what the application really published.
- `createTestInternalTokens` generates Ed25519 keys for the run and signs and verifies internal tokens with `@cadenway/nest-common`.
- `startHttpFakes` and the re-exported `http`, `HttpResponse`, `delay` and `passthrough` of `msw` fake third-party HTTP: a request no handler answers fails instead of reaching the network.

The caller supplies the signer and verifier factories from its installed Service Kit, so Toolkit
can reuse real authentication without a private runtime dependency. `@nats-io/jetstream` and
`@nats-io/transport-node` become dependencies. `@testcontainers/nats` is no longer needed.
