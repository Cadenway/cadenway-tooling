/**
 * Constant POSTGRES_IMAGE
 *
 * @description
 * PostgreSQL image of the disposable database: the tag cadenway-ops pins in `compose/infra.yaml`.
 * PostgreSQL 18 is required for `uuidv7()`.
 *
 * @type {string}
 */
export const POSTGRES_IMAGE: string = 'postgres:18.6-alpine';

/**
 * Constant NATS_IMAGE
 *
 * @description
 * NATS image of the disposable server: the tag cadenway-ops pins in `compose/infra.yaml`.
 *
 * @type {string}
 */
export const NATS_IMAGE: string = 'nats:2.15.2-alpine';

/**
 * Constant REDIS_IMAGE
 *
 * @description
 * Redis image of the disposable server: the tag cadenway-ops pins in `compose/infra.yaml`.
 *
 * @type {string}
 */
export const REDIS_IMAGE: string = 'redis:8.10.3-alpine';
