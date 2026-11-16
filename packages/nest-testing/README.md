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

For `kit`, use `profile: 'kit', convention: 'strict'` in the same check. The verifier reads each
package's declared exports and maps build outputs to authored sources. It checks package imports
before a workspace build, rejects imports through private paths or aliases, and requires messaging
to declare its production dependency on common. Messaging may depend on common. Common and jobs
are independent of the other kit packages.

The kit profile rejects test code in export targets or production imports and detects eager
execution cycles. The targets of the outbox `/writer`, `/relay` and `/schema` entries and the
jobs `/runtime` and `/provisioning` entries belong to their respective source directories, including
the targets of declaration exports. The verifier follows intermediate and type imports. The
outbox writer and relay can share schema definitions and compose through the legacy façade.
Schema definitions stay independent of writer, relay and wiring. Jobs runtime and provisioning
can share the schema contract. The database reads request context independently of the internal
token guard.

For `service` and `gateway`, `convention: 'strict'` enables the V2 folder and dependency rules. It
requires all authored modules and capabilities to follow the convention, including existing ones.
Use `profile: 'gateway'` for both HTTP and realtime gateways. Both profiles identify capabilities
under `src/modules/<module>/`, require a module manifest and Nest composition root, and check
public entries against the owner's declared consumers, providers and use case signatures. HTTP
controllers depend on a use case even for one-to-one routes. The gateway profile still keeps SQL
and transactional outbox code in services, restricts generated clients to their technical
adapters, and supports explicitly published HTTP guards. Fixture tests run without starting Nest
or any infrastructure.

The strict service and gateway profiles check common, messaging and jobs imports against the
Service Kit public entry list. The list includes the compatibility entries, telemetry hooks and
the narrow outbox and jobs entries. Use these published entries directly. When adding a new
entry to a kit package, update the verifier's public entry list with it.

`<module>.module.ts` can declare tokens and factory providers inline. The optional
`composition/` directory holds wiring split into separate files. Strict verification accepts both.

Strict verification ties the named exports of authored `.use-case.ts`, `.input.ts`, `.output.ts`,
`.port.ts` and `.dto.ts` files to their filename and role, and requires a public instance `execute`
method on use cases. Keep each named exported contract in its own file and private helpers beside
their caller. Give reusable functions responsibility-specific names and paths. The verifier flags
generic utility paths in authored source and skips generated gateway clients.

Place cross-layer integration specs and their support files in `tests/`. Keep unit specs and
single-adapter integration specs beside their subject. Strict mode reports TypeScript sources under
the singular root `test/`; the legacy convention accepts both root paths during migration.

Omit `convention` to keep the existing rules. In that mode, an exception names the exact `file` and
`rule` and states its `reason`. The verifier rejects stale exceptions. Strict mode rejects exceptions.

Adopt V2 after its package release. Update the released development dependency and set the
convention in the consumer's existing `test:architecture` suite. Keep dependency updates, lockfiles
and test activation in the consumer checkout. A strict suite with findings fails in CI.

The root entry point remains reserved for the planned disposable PostgreSQL and NATS fixtures,
as listed in the [NestJS architecture guide](https://github.com/Cadenway/cadenway-service-kit/blob/main/docs/hexagonal-architecture.md).
When those fixtures ship, validate them in two services against published archives. Check which
peers each service needs and exercise the supported range of the optional `@cadenway/nest-messaging`
peer. Keep `/architecture` runnable without containers and retain the services’ Compose scenarios
for full startup coverage.
