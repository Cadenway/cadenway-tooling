import { connect as connectTcp, type Socket } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createTestApp } from './create-test-app.js';

const CONTAINER_START_TIMEOUT_MS = 180_000;
const tokenFactories = {
  createSigner: async (): Promise<never> => {
    throw new Error('Unexpected signing during startup.');
  },
  createVerifier: async (): Promise<never> => {
    throw new Error('Unexpected verification during startup.');
  },
};

/**
 * Function ping
 *
 * @description
 * Sends `PING` to a Redis server over a plain socket.
 *
 * @param {string} url - `redis://host:port` address.
 * @returns {Promise<string>} The reply line.
 */
function ping(url: string): Promise<string> {
  const address: URL = new URL(url);
  return new Promise<string>((resolve: (reply: string) => void, reject: (error: Error) => void) => {
    const socket: Socket = connectTcp(Number(address.port), address.hostname, (): void => {
      socket.write('PING\r\n');
    });
    socket.once('data', (data: Buffer): void => {
      socket.destroy();
      resolve(data.toString().trim());
    });
    socket.once('error', reject);
    // A port whose container was just removed may accept the connection and close it at once.
    socket.once('close', (): void => {
      reject(new Error('The server closed the connection without answering.'));
    });
  });
}

describe('createTestApp when a step fails', () => {
  it(
    'stops what started, restores the environment and reports the first failure',
    async () => {
      const before: string | undefined = process.env.REDIS_URL;
      let redisUrl: string | undefined;

      await expect(
        createTestApp({
          tokenFactories,
          service: 'api-gateway',
          postgres: false,
          nats: false,
          redis: true,
          create: (infrastructure): Promise<never> => {
            redisUrl = infrastructure.redis.url;
            return Promise.reject(new Error('The application module failed to load.'));
          },
        }),
      ).rejects.toThrow('The application module failed to load.');

      expect(process.env.REDIS_URL).toBe(before);
      expect(redisUrl).toBeDefined();
      await expect(ping(redisUrl ?? '')).rejects.toThrow();
    },
    CONTAINER_START_TIMEOUT_MS,
  );

  it('refuses a service whose NATS grant is unknown, before starting anything', async () => {
    await expect(
      createTestApp({
        tokenFactories,
        service: 'reporting-service',
        postgres: false,
        create: (): Promise<never> => Promise.reject(new Error('never called')),
      }),
    ).rejects.toThrow('No NATS grant is known for the user "reporting"');
  });

  it('refuses migrations without PostgreSQL before creating the application', async () => {
    await expect(
      createTestApp({
        tokenFactories,
        service: 'api-gateway',
        postgres: false,
        nats: false,
        migrationsFolder: 'migrations',
        create: (): Promise<never> => Promise.reject(new Error('never called')),
      }),
    ).rejects.toThrow('Migrations need PostgreSQL');
  });
});
