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

The disposable PostgreSQL and NATS instances listed in the
[NestJS architecture guide](https://github.com/Cadenway/cadenway-service-kit/blob/main/docs/hexagonal-architecture.md)
are not part of this entry point yet.
