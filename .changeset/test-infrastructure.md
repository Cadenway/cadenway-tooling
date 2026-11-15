---
'@cadenway/nest-testing': minor
---

Add the integration test infrastructure to the root entry point.

- `createTestApp({ service, create, migrationsFolder })` starts disposable PostgreSQL, NATS with JetStream and, for a gateway, Redis through Testcontainers, on the image tags cadenway-ops pins (`POSTGRES_IMAGE`, `NATS_IMAGE`, `REDIS_IMAGE`). It applies the Drizzle migrations as the migrator role, sets `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `NATS_URL`, `REDIS_URL` and the internal token variables, then builds and initializes the application. It returns the application with `database`, `nats`, `events`, `redis`, `tokens`, `http` and `close`. Nothing starts at import time.
- `startTestDatabase` creates the database and the two roles of a service as cadenway-ops does: `<database>_migrator` owns the database and runs the DDL; `<database>_app` reads and writes rows only, creates nothing, does not bypass row-level security and carries the deployed timeouts. `asOrganization` and `asSystem` run work as the application role with `app.organization_id` or `app.system_access` set for the transaction.
- `assertTenantIsolation`, `checkTenantIsolation` and `findUnprotectedTables` prove that row-level security is enabled, forced and effective between two organizations.
- `startTestNats` runs NATS with the command of cadenway-ops (no client credentials) and creates the `EVENTS` stream on `evt.>`; its event recorder (`waitFor`, `named`, `sync`, `clear`) reads what the application really published.
- `createTestInternalTokens` generates Ed25519 keys for the run and signs and verifies internal tokens with `@cadenway/nest-common`.
- `startHttpFakes` and the re-exported `http`, `HttpResponse`, `delay` and `passthrough` of `msw` fake third-party HTTP: a request no handler answers fails instead of reaching the network.

`@cadenway/nest-common` becomes an optional peer (`>=0.2.0 <1.0.0`), used by the internal token helpers. `@nats-io/jetstream` and `@nats-io/transport-node` become dependencies; `@testcontainers/nats` is no longer one.
