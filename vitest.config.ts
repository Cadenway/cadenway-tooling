import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['packages/*/src/**/*.int-spec.ts'],
          // Integration specs start disposable PostgreSQL, NATS and Redis containers in their hooks.
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'service-kit',
          include: ['packages/nest-testing/tests/service-kit/*.{spec,int-spec}.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
