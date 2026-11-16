import { generateKeyPairSync, type JsonWebKey } from 'node:crypto';

import type {
  Ed25519PrivateJwk,
  Ed25519PublicJwk,
  InternalPrincipal,
  InternalTokenClaims,
  InternalTokenSigner,
  InternalTokenVerifier,
} from '@cadenway/nest-common';

/**
 * Constant DEFAULT_ISSUER
 *
 * @description
 * Issuer of the test tokens unless told otherwise: the API gateway, the usual caller of a
 * service.
 *
 * @type {string}
 */
const DEFAULT_ISSUER: string = 'api-gateway';

/**
 * Interface TestInternalTokensOptions
 *
 * @description
 * Options of `createTestInternalTokens`.
 */
export interface TestInternalTokensOptions {
  // #region Properties
  /**
   * Property audience
   *
   * @description
   * Name of the service under test, such as `task-service`: the `aud` of the tokens by default.
   *
   * @type {string}
   * @readonly
   */
  readonly audience: string;

  /**
   * Property issuers
   *
   * @description
   * Services allowed to call the one under test. Each gets its own key. Tokens are signed by the
   * first unless `sign` names another. Defaults to `api-gateway` alone.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly issuers?: readonly string[];
  // #endregion
}

/**
 * Interface SignTestTokenOptions
 *
 * @description
 * What a test token deviates on, to exercise a refusal.
 */
export interface SignTestTokenOptions {
  // #region Properties
  /**
   * Property issuer
   *
   * @description
   * Issuer that signs the token, one of the configured issuers. Defaults to the first.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly issuer?: string;

  /**
   * Property audience
   *
   * @description
   * Service the token is issued for. Defaults to the service under test; another name gives a
   * token it must refuse.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly audience?: string;
  // #endregion
}

/**
 * Type InternalTokenVerifierEnvironment
 *
 * @description
 * Variables of a service that verifies internal tokens, as `internalTokenVerifierConfigShape`
 * of `@cadenway/nest-common` reads them.
 */
export type InternalTokenVerifierEnvironment = {
  // #region Properties
  /**
   * Property INTERNAL_TOKEN_AUDIENCE
   *
   * @description
   * Name of the service under test.
   *
   * @type {string}
   * @readonly
   */
  readonly INTERNAL_TOKEN_AUDIENCE: string;

  /**
   * Property INTERNAL_TOKEN_TRUSTED_ISSUERS
   *
   * @description
   * Verification keys of the test issuers, as one line of JSON.
   *
   * @type {string}
   * @readonly
   */
  readonly INTERNAL_TOKEN_TRUSTED_ISSUERS: string;
  // #endregion
};

/**
 * Type InternalTokenSignerEnvironment
 *
 * @description
 * Variables of an application that signs internal tokens, as `internalTokenSignerConfigShape`
 * of `@cadenway/nest-common` reads them.
 */
export type InternalTokenSignerEnvironment = {
  // #region Properties
  /**
   * Property INTERNAL_TOKEN_ISSUER
   *
   * @description
   * Name of the issuer.
   *
   * @type {string}
   * @readonly
   */
  readonly INTERNAL_TOKEN_ISSUER: string;

  /**
   * Property INTERNAL_TOKEN_PRIVATE_JWK
   *
   * @description
   * Signing key of the issuer, as one line of JSON. Generated for the run: it signs nothing a
   * deployed service accepts.
   *
   * @type {string}
   * @readonly
   */
  readonly INTERNAL_TOKEN_PRIVATE_JWK: string;
  // #endregion
};

/**
 * Interface TestInternalTokens
 *
 * @description
 * Internal token keys generated for one test run, with what the application under test needs to
 * trust them and what a test needs to call a guarded route.
 */
export interface TestInternalTokens {
  // #region Properties
  /**
   * Property audience
   *
   * @description
   * Name of the service under test.
   *
   * @type {string}
   * @readonly
   */
  readonly audience: string;

  /**
   * Property issuers
   *
   * @description
   * Names of the issuers that have a key, the default signer first.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly issuers: readonly string[];

  /**
   * Property trustedIssuers
   *
   * @description
   * Verification keys by issuer: the `trustedIssuers` option of the verifier.
   *
   * @type {Readonly<Record<string, readonly Ed25519PublicJwk[]>>}
   * @readonly
   */
  readonly trustedIssuers: Readonly<Record<string, readonly Ed25519PublicJwk[]>>;

  /**
   * Property verifierEnv
   *
   * @description
   * Environment variables that make the service under test trust the test issuers.
   *
   * @type {InternalTokenVerifierEnvironment}
   * @readonly
   */
  readonly verifierEnv: InternalTokenVerifierEnvironment;
  // #endregion

  // #region Methods
  /**
   * Method signerEnv
   *
   * @description
   * Returns the environment variables that make the application under test sign as one of the
   * issuers: a gateway whose calls to faked services are then checked with `verify`.
   *
   * @param {string} issuer - One of the configured issuers. Defaults to the first.
   * @returns {InternalTokenSignerEnvironment} The issuer name and its signing key.
   * @throws {Error} When the issuer has no key.
   */
  signerEnv(issuer?: string): InternalTokenSignerEnvironment;

  /**
   * Method sign
   *
   * @description
   * Signs an internal token with the signer of `@cadenway/nest-common`, valid 60 seconds.
   *
   * @param {InternalTokenClaims} claims - Who the call is made for.
   * @param {SignTestTokenOptions} options - Another issuer or audience.
   * @returns {Promise<string>} The compact JWT.
   * @throws {Error} When the issuer has no key or the claims are inconsistent.
   */
  sign(claims: InternalTokenClaims, options?: SignTestTokenOptions): Promise<string>;

  /**
   * Method authorization
   *
   * @description
   * Signs a token and returns the value of the `Authorization` header that carries it.
   *
   * @param {InternalTokenClaims} claims - Who the call is made for.
   * @param {SignTestTokenOptions} options - Another issuer or audience.
   * @returns {Promise<string>} `Bearer <token>`.
   */
  authorization(claims: InternalTokenClaims, options?: SignTestTokenOptions): Promise<string>;

  /**
   * Method verify
   *
   * @description
   * Verifies a token the application under test sent to a faked service, with the verifier of
   * `@cadenway/nest-common`, and returns who the call was made for.
   *
   * @param {string} token - Compact JWT, or the whole `Bearer <token>` header value.
   * @param {string} audience - Name of the faked service. Defaults to the service under test.
   * @returns {Promise<InternalPrincipal>} The verified principal.
   * @throws {Error} When the token is not valid for that service.
   */
  verify(token: string, audience?: string): Promise<InternalPrincipal>;
  // #endregion
}

/**
 * Function generateSigningJwk
 *
 * @description
 * Generates a fresh Ed25519 signing key. Keys are never written in a repository: every run makes
 * its own.
 *
 * @param {string} kid - Key id to give the key.
 * @returns {Ed25519PrivateJwk} The private JWK.
 */
export function generateSigningJwk(kid: string): Ed25519PrivateJwk {
  const jwk: JsonWebKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string' || typeof jwk.d !== 'string') {
    throw new Error('The generated key is not an Ed25519 private key.');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d, kid };
}

/**
 * Function publicJwkOf
 *
 * @description
 * Returns the verification key matching a signing key.
 *
 * @param {Ed25519PrivateJwk} jwk - Signing key.
 * @returns {Ed25519PublicJwk} The public JWK, without the private member.
 */
export function publicJwkOf(jwk: Ed25519PrivateJwk): Ed25519PublicJwk {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid: jwk.kid };
}

/**
 * Function createTestInternalTokens
 *
 * @description
 * Generates one signing key per issuer and returns what a test needs around them. The tokens are
 * signed and verified by `@cadenway/nest-common` itself, loaded on first use, so they are exactly
 * what a real caller sends.
 *
 * @param {TestInternalTokensOptions} options - Service under test and its issuers.
 * @returns {TestInternalTokens} The keys, the environment variables and the signer.
 * @throws {Error} When no issuer is given.
 */
export function createTestInternalTokens(options: TestInternalTokensOptions): TestInternalTokens {
  const issuers: readonly string[] = Object.freeze([...(options.issuers ?? [DEFAULT_ISSUER])]);
  const defaultIssuer: string | undefined = issuers[0];
  if (defaultIssuer === undefined) {
    throw new Error('At least one issuer is required to sign test tokens.');
  }
  const keys: Map<string, Ed25519PrivateJwk> = new Map<string, Ed25519PrivateJwk>(
    issuers.map((issuer: string): [string, Ed25519PrivateJwk] => [
      issuer,
      generateSigningJwk(`${issuer}-test`),
    ]),
  );
  const trustedIssuers: Readonly<Record<string, readonly Ed25519PublicJwk[]>> = Object.freeze(
    Object.fromEntries(
      [...keys].map(([issuer, jwk]: [string, Ed25519PrivateJwk]) => [issuer, [publicJwkOf(jwk)]]),
    ),
  );
  const signers: Map<string, Promise<InternalTokenSigner>> = new Map<
    string,
    Promise<InternalTokenSigner>
  >();
  const verifiers: Map<string, Promise<InternalTokenVerifier>> = new Map<
    string,
    Promise<InternalTokenVerifier>
  >();
  /**
   * Function keyOf
   *
   * @description
   * Returns the signing key of an issuer.
   *
   * @param {string} issuer - Issuer name.
   * @returns {Ed25519PrivateJwk} Its key.
   * @throws {Error} When the issuer has no key.
   */
  const keyOf = (issuer: string): Ed25519PrivateJwk => {
    const jwk: Ed25519PrivateJwk | undefined = keys.get(issuer);
    if (jwk === undefined) {
      throw new Error(`No test key for the issuer ${issuer}: list it in "issuers".`);
    }
    return jwk;
  };
  /**
   * Function sign
   *
   * @description
   * Signs a token as one issuer, creating its signer on first use.
   *
   * @param {InternalTokenClaims} claims - Who the call is made for.
   * @param {SignTestTokenOptions} signOptions - Another issuer or audience.
   * @returns {Promise<string>} The compact JWT.
   */
  const sign = async (
    claims: InternalTokenClaims,
    signOptions: SignTestTokenOptions = {},
  ): Promise<string> => {
    const issuer: string = signOptions.issuer ?? defaultIssuer;
    const privateJwk: Ed25519PrivateJwk = keyOf(issuer);
    let signer: Promise<InternalTokenSigner> | undefined = signers.get(issuer);
    if (signer === undefined) {
      signer = import('@cadenway/nest-common').then(
        (common: typeof import('@cadenway/nest-common')): Promise<InternalTokenSigner> =>
          common.InternalTokenSigner.create({ issuer, privateJwk }),
      );
      signers.set(issuer, signer);
    }
    return (await signer).sign(signOptions.audience ?? options.audience, claims);
  };
  return {
    audience: options.audience,
    issuers,
    trustedIssuers,
    verifierEnv: Object.freeze({
      INTERNAL_TOKEN_AUDIENCE: options.audience,
      INTERNAL_TOKEN_TRUSTED_ISSUERS: JSON.stringify(trustedIssuers),
    }),
    signerEnv: (issuer: string = defaultIssuer): InternalTokenSignerEnvironment => ({
      INTERNAL_TOKEN_ISSUER: issuer,
      INTERNAL_TOKEN_PRIVATE_JWK: JSON.stringify(keyOf(issuer)),
    }),
    sign,
    authorization: async (
      claims: InternalTokenClaims,
      signOptions: SignTestTokenOptions = {},
    ): Promise<string> => `Bearer ${await sign(claims, signOptions)}`,
    verify: async (
      token: string,
      audience: string = options.audience,
    ): Promise<InternalPrincipal> => {
      let verifier: Promise<InternalTokenVerifier> | undefined = verifiers.get(audience);
      if (verifier === undefined) {
        verifier = import('@cadenway/nest-common').then(
          (common: typeof import('@cadenway/nest-common')): Promise<InternalTokenVerifier> =>
            common.InternalTokenVerifier.create({ audience, trustedIssuers }),
        );
        verifiers.set(audience, verifier);
      }
      return (await verifier).verify(token.replace(/^Bearer /u, ''));
    },
  };
}
