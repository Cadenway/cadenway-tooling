/**
 * Disposable test infrastructure for the Cadenway NestJS services and gateways.
 *
 * Importing this entry point starts nothing. Start containers explicitly and release them
 * through the helper's stop method or by closing the test application.
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
