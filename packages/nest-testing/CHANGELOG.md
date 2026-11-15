# @cadenway/nest-testing

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
