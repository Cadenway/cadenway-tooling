/**
 * Public entry point of `@cadenway/nest-testing`: what the tests of the Cadenway services and
 * gateways share. Everything a consumer may import is listed here by name.
 *
 * The fixtures are plain data taken from the mockup (Atelier Nord, Sprint 14, `CAD-482`). The
 * static architecture verifier lives in `@cadenway/nest-testing/architecture`.
 *
 * @packageDocumentation
 */
export {
  type AtelierNordFixture,
  type CooperativeLumenFixture,
  type FixtureInitials,
  type FixtureMemberRole,
  type FixtureOrganization,
  type FixturePerson,
} from './fixtures/atelier-nord.js';
export { fixtureId, type FixtureIdGroup } from './fixtures/fixture-id.js';
export { fixtures, type Fixtures } from './fixtures/fixtures.js';
export {
  type FixtureChecklistItem,
  type FixtureComment,
  type FixtureSpace,
  type FixtureSprint,
  type FixtureStatus,
  type FixtureTask,
  type Sprint14Fixture,
} from './fixtures/sprint-14.js';
