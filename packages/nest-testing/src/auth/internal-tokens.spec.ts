import { describe, expect, it, vi } from 'vitest';

import { createTestInternalTokens, generateSigningJwk, publicJwkOf } from './internal-tokens.js';

describe('generateSigningJwk', () => {
  it('makes a new Ed25519 key at every call and never exposes the private member publicly', () => {
    const first: ReturnType<typeof generateSigningJwk> = generateSigningJwk('gateway-test');
    const second: ReturnType<typeof generateSigningJwk> = generateSigningJwk('gateway-test');

    expect(first).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'gateway-test' });
    expect(first.d).not.toBe(second.d);
    expect(publicJwkOf(first)).toEqual({
      kty: 'OKP',
      crv: 'Ed25519',
      x: first.x,
      kid: 'gateway-test',
    });
  });
});

it('passes isolated keys, audiences and typed claims to the injected helpers', async () => {
  const sign = vi.fn<(audience: string, claims: { subject: string }) => Promise<string>>();
  const verify = vi.fn<(token: string) => Promise<{ verified: boolean }>>();
  const tokenFactories = {
    createSigner: vi.fn(async () => ({ sign })),
    createVerifier: vi.fn(async () => ({ verify })),
  };
  sign.mockResolvedValue('test-token');
  verify.mockResolvedValue({ verified: true });

  const tokens = createTestInternalTokens({
    audience: 'task-service',
    issuers: ['api-gateway', 'automation-service'],
    tokenFactories,
  });

  const claims = { subject: 'test' };
  await expect(
    tokens.authorization(claims, { issuer: 'automation-service', audience: 'billing-service' }),
  ).resolves.toBe('Bearer test-token');
  await tokens.sign(claims, { issuer: 'automation-service' });
  expect(tokenFactories.createSigner.mock.calls).toEqual([
    [
      {
        issuer: 'automation-service',
        privateJwk: expect.objectContaining({ d: expect.any(String) }),
      },
    ],
  ]);
  expect(sign.mock.calls).toEqual([
    ['billing-service', claims],
    ['task-service', claims],
  ]);

  await expect(tokens.verify('Bearer test-token')).resolves.toEqual({ verified: true });
  await tokens.verify('test-token');
  expect(verify.mock.calls).toEqual([['test-token'], ['test-token']]);
  expect(tokenFactories.createVerifier.mock.calls).toEqual([
    [{ audience: 'task-service', trustedIssuers: tokens.trustedIssuers }],
  ]);
  expect(tokens.verifierEnv.INTERNAL_TOKEN_TRUSTED_ISSUERS).not.toContain('"d"');
});
