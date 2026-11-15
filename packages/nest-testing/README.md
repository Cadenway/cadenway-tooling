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
});
```

At the top of `src/`, a service holds only its process entry points (`main.ts`, `migrate.ts`, and
`telemetry.ts`, which `@cadenway/nest-common` preloads with `node --import ./dist/telemetry.js`),
`app.module.ts`, and `config/`, `health/` and `infrastructure/`. Anything else belongs to a module
under `src/modules/<module>/` (`service-layout`).

Use `service` for a business service, `gateway` for an HTTP or realtime gateway, and `kit` for the
service-kit workspace. Findings carry repository-relative `file`, one-based `line`, `rule` and
`message`. An exception must name the exact `file` and `rule`, and state its `reason`. The verifier
rejects stale exceptions.

The root entry point remains reserved for the planned disposable PostgreSQL and NATS fixtures,
as listed in the [NestJS architecture guide](https://github.com/Cadenway/cadenway-service-kit/blob/main/docs/hexagonal-architecture.md).
