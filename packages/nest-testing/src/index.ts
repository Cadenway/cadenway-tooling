/**
 * Public entry point of `@cadenway/nest-testing`: what the tests of the Cadenway services and
 * gateways share. Everything a consumer may import is listed here by name.
 *
 * - `createTestApp` starts disposable PostgreSQL, NATS and Redis containers, applies the
 *   migrations of the service and returns its application with an event recorder, internal
 *   token keys and third-party fakes.
 * - The fixtures are plain data taken from the mockup (Atelier Nord, Sprint 14, `CAD-482`).
 *
 * Importing this file starts nothing: every container is started by an explicit call and
 * removed by its `stop` or by `close` of the test application. The static architecture verifier
 * lives in `@cadenway/nest-testing/architecture`.
 *
 * @packageDocumentation
 */
export {
  createTestApp,
  type CreateTestAppOptions,
  type TestApp,
  type TestApplication,
  type TestEnvironment,
  type TestInfrastructure,
} from './app/create-test-app.js';
export {
  createTestInternalTokens,
  generateSigningJwk,
  publicJwkOf,
  type InternalTokenSignerEnvironment,
  type InternalTokenVerifierEnvironment,
  type SignTestTokenOptions,
  type TestInternalTokens,
  type TestInternalTokensOptions,
} from './auth/internal-tokens.js';
export { NATS_IMAGE, POSTGRES_IMAGE, REDIS_IMAGE } from './containers/images.js';
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
export { startHttpFakes, type HttpFakes, type HttpFakesOptions } from './http/http-fakes.js';
export {
  EVENT_SUBJECT_PREFIX,
  type EventRecorder,
  type RecordedEvent,
  type WaitForEventOptions,
} from './nats/event-recorder.js';
export {
  type NatsPermissions,
  type TestNatsCredentials,
  type TestNatsGrant,
  type TestNatsUser,
} from './nats/nats-users.js';
export {
  EVENTS_DLQ_STREAM,
  EVENTS_RESTRICTED_STREAM,
  EVENTS_STREAM,
  EVENTS_SUBJECTS,
  startTestNats,
  type PublishEventOptions,
  type TestNats,
  type TestNatsOptions,
  type TestStream,
} from './nats/test-nats.js';
export {
  assertTenantIsolation,
  checkTenantIsolation,
  findUnprotectedTables,
  type TenantIsolationOptions,
  type TenantIsolationReport,
  type UnprotectedTable,
} from './postgres/tenant-isolation.js';
export {
  ORGANIZATION_SETTING,
  startTestDatabase,
  SYSTEM_ACCESS_SETTING,
  type TestDatabase,
  type TestDatabaseOptions,
  type TestDatabaseRoles,
} from './postgres/test-database.js';
export { startTestRedis, type TestRedis, type TestRedisOptions } from './redis/test-redis.js';
export { delay, http, HttpResponse, passthrough } from 'msw';
