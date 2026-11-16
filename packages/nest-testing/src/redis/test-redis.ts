import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

import { REDIS_IMAGE } from '../containers/images.js';

/**
 * Interface TestRedisOptions
 *
 * @description
 * Options of `startTestRedis`.
 */
export interface TestRedisOptions {
  // #region Properties
  /**
   * Property image
   *
   * @description
   * Redis image. Defaults to `REDIS_IMAGE`, the tag cadenway-ops pins.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly image?: string;
  // #endregion
}

/**
 * Interface TestRedis
 *
 * @description
 * Disposable Redis server, for the gateways.
 */
export interface TestRedis {
  // #region Properties
  /**
   * Property url
   *
   * @description
   * Address of the server: the `REDIS_URL` of the application under test.
   *
   * @type {string}
   * @readonly
   */
  readonly url: string;
  // #endregion

  // #region Methods
  /**
   * Method stop
   *
   * @description
   * Removes the container.
   *
   * @returns {Promise<void>} Resolves once stopped.
   */
  stop(): Promise<void>;
  // #endregion
}

/**
 * Function startTestRedis
 *
 * @description
 * Starts a disposable Redis server. Nothing starts before this call, and `stop` removes it.
 *
 * @param {TestRedisOptions} options - Image.
 * @returns {Promise<TestRedis>} The running server.
 */
export async function startTestRedis(options: TestRedisOptions = {}): Promise<TestRedis> {
  const container: StartedRedisContainer = await new RedisContainer(
    options.image ?? REDIS_IMAGE,
  ).start();
  return {
    url: container.getConnectionUrl(),
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
