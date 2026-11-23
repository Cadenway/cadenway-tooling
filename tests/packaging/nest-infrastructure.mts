import { createTestApp, type TestTokenFactories } from '@cadenway/nest-testing/infrastructure';

interface Claims {
  readonly organizationId: string;
}

interface Principal {
  readonly audience: string;
}

declare const tokenFactories: TestTokenFactories<Claims, Principal>;

const testApp = await createTestApp({
  service: 'api-gateway',
  postgres: false,
  nats: false,
  tokenFactories,
  create: async () => ({
    init: async () => {},
    close: async () => {},
  }),
});

const authorization: string = await testApp.tokens.authorization({ organizationId: 'example' });
const principal: Principal = await testApp.tokens.verify(authorization);
