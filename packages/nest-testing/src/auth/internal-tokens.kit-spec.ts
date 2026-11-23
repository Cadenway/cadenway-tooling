import {
  internalTokenSignerConfigShape,
  internalTokenVerifierConfigShape,
  InternalTokenSigner,
  InternalTokenVerifier,
  type InternalPrincipal,
  type InternalTokenClaims,
} from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fixtures } from '../fixtures/fixtures.js';
import { createTestInternalTokens, type TestInternalTokens } from './internal-tokens.js';

const tokenFactories = {
  createSigner: InternalTokenSigner.create,
  createVerifier: InternalTokenVerifier.create,
};

describe('createTestInternalTokens', () => {
  const { organization, CM } = fixtures.atelierNord();
  const tokens: TestInternalTokens<InternalTokenClaims, InternalPrincipal> =
    createTestInternalTokens({
      tokenFactories,
      audience: 'task-service',
      issuers: ['api-gateway', 'automation-service'],
    });

  it('signs a token the verifier of the kit accepts for the service under test', async () => {
    const token: string = await tokens.sign({
      actor: { type: 'user', id: CM.id },
      organizationId: organization.id,
      role: CM.role,
      scopes: ['tasks:read'],
    });

    const principal: InternalPrincipal = await tokens.verify(token);

    expect(principal).toMatchObject({
      issuer: 'api-gateway',
      audience: 'task-service',
      organizationId: organization.id,
      actor: { type: 'user', id: CM.id },
      role: 'owner',
      scopes: ['tasks:read'],
    });
  });

  it('signs as another configured issuer', async () => {
    const header: string = await tokens.authorization(
      { actor: { type: 'automation', id: 'rule-1' }, organizationId: organization.id },
      { issuer: 'automation-service' },
    );

    expect(header.startsWith('Bearer ')).toBe(true);
    expect((await tokens.verify(header)).issuer).toBe('automation-service');
  });

  it('signs a token for another audience, which the service under test refuses', async () => {
    const token: string = await tokens.sign(
      { actor: { type: 'user', id: CM.id }, organizationId: organization.id },
      { audience: 'billing-service' },
    );

    await expect(tokens.verify(token)).rejects.toMatchObject({
      problem: { status: 401, code: 'auth.token-invalid', details: { reason: 'audience' } },
    });
    expect((await tokens.verify(token, 'billing-service')).audience).toBe('billing-service');
  });

  it('refuses to sign as an issuer that has no key', async () => {
    await expect(
      tokens.sign(
        { actor: { type: 'system', id: null }, organizationId: null },
        { issuer: 'integration-service' },
      ),
    ).rejects.toThrow('No test key for the issuer integration-service');
    expect(() => tokens.signerEnv('integration-service')).toThrow('No test key');
  });

  it('gives environment variables the configuration shapes of the kit accept', () => {
    const verifier: z.ZodSafeParseResult<unknown> = z
      .object(internalTokenVerifierConfigShape)
      .safeParse(tokens.verifierEnv);
    const signer: z.ZodSafeParseResult<unknown> = z
      .object(internalTokenSignerConfigShape)
      .safeParse(tokens.signerEnv());

    expect(verifier.success).toBe(true);
    expect(verifier.data).toEqual({
      INTERNAL_TOKEN_AUDIENCE: 'task-service',
      INTERNAL_TOKEN_TRUSTED_ISSUERS: tokens.trustedIssuers,
    });
    expect(signer.success).toBe(true);
    expect(signer.data).toMatchObject({ INTERNAL_TOKEN_ISSUER: 'api-gateway' });
  });

  it('keeps private keys out of what the verifier receives', () => {
    expect(tokens.verifierEnv.INTERNAL_TOKEN_TRUSTED_ISSUERS).not.toContain('"d"');
    expect(Object.keys(tokens.trustedIssuers)).toEqual(['api-gateway', 'automation-service']);
  });

  it('makes different keys for every run', () => {
    const other: TestInternalTokens<InternalTokenClaims, InternalPrincipal> =
      createTestInternalTokens({ tokenFactories, audience: 'task-service' });

    expect(other.issuers).toEqual(['api-gateway']);
    expect(other.trustedIssuers['api-gateway']).not.toEqual(tokens.trustedIssuers['api-gateway']);
  });

  it('refuses an empty list of issuers', () => {
    expect(() =>
      createTestInternalTokens({ tokenFactories, audience: 'task-service', issuers: [] }),
    ).toThrow('At least one issuer');
  });
});
