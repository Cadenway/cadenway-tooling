# @cadenway/nest-testing

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
