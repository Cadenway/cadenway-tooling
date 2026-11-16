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
Use `profile: 'gateway'` for both HTTP and realtime gateways. The verifier identifies a capability
by its full path, such as `routes/auth` or `relays/tasks`, and checks public entries against their
owning module's declarations, exported providers and case signatures. Fixture tests can exercise
the verifier without starting Nest or any infrastructure.

Omit `convention` to keep the existing rules. In that mode, an exception names the exact `file` and
`rule` and states its `reason`. The verifier rejects stale exceptions. Strict mode rejects exceptions.

Adopt V2 after its package release. Update the released development dependency and set the
convention in the consumer's existing `test:architecture` suite. Keep dependency updates, lockfiles
and test activation in the consumer checkout. A strict suite with findings fails in CI.

The root entry point remains reserved for the planned disposable PostgreSQL and NATS fixtures,
as listed in the [NestJS architecture guide](https://github.com/Cadenway/cadenway-service-kit/blob/main/docs/hexagonal-architecture.md).
