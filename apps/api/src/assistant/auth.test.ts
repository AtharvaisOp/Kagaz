import type { DecodedIdToken } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import { FirebaseGoogleAuthenticator } from './auth.js';
import { readAssistantConfig } from './config.js';

const PROJECT = 'demo-kagaz-phase6c';
const token: DecodedIdToken = {
  uid: 'trusted-google-uid',
  sub: 'trusted-google-uid',
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  auth_time: 1,
  iat: 1,
  exp: 9_999_999_999,
  email_verified: true,
  firebase: {
    identities: { 'google.com': ['google-subject'] },
    sign_in_provider: 'google.com',
  },
};
function fixture(decoded = token) {
  const verifyIdToken = vi
    .fn<(idToken: string, checkRevoked?: boolean) => Promise<DecodedIdToken>>()
    .mockResolvedValue(decoded);
  return {
    auth: new FirebaseGoogleAuthenticator({ verifyIdToken }, PROJECT),
    verifyIdToken,
  };
}

describe('Google-only server authentication', () => {
  it('derives identity from the verified token and checks revocation every time', async () => {
    const { auth, verifyIdToken } = fixture();
    expect(await auth.authenticate('Bearer verified.token')).toEqual({
      uid: 'trusted-google-uid',
    });
    expect(verifyIdToken).toHaveBeenCalledWith('verified.token', true);
  });
  it.each([
    undefined,
    '',
    'Basic token',
    'Bearer one two',
    `Bearer ${'a'.repeat(8193)}`,
  ])('rejects absent or invalid bearer headers', async (header) => {
    const { auth, verifyIdToken } = fixture();
    await expect(auth.authenticate(header)).rejects.toMatchObject({
      status: 401,
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
  it.each(['expired', 'revoked', 'disabled-user', 'wrong-signature'])(
    'sanitizes %s verification failures',
    async () => {
      const { auth, verifyIdToken } = fixture();
      verifyIdToken.mockRejectedValue(new Error('secret bearer contents'));
      await expect(auth.authenticate('Bearer token')).rejects.toMatchObject({
        code: 'invalid-authentication',
        status: 401,
      });
    },
  );
  it.each(['password', 'anonymous', 'custom', 'github.com'])(
    'rejects the %s sign-in provider',
    async (provider) => {
      const { auth } = fixture({
        ...token,
        firebase: { identities: {}, sign_in_provider: provider },
      });
      await expect(auth.authenticate('Bearer token')).rejects.toMatchObject({
        code: 'google-sign-in-required',
      });
    },
  );
  it('rejects another project and an unverified email', async () => {
    await expect(
      fixture({ ...token, aud: 'other' }).auth.authenticate('Bearer token'),
    ).rejects.toMatchObject({ code: 'invalid-authentication' });
    await expect(
      fixture({
        ...token,
        iss: 'https://securetoken.google.com/other',
      }).auth.authenticate('Bearer token'),
    ).rejects.toMatchObject({ code: 'invalid-authentication' });
    await expect(
      fixture({ ...token, email_verified: false }).auth.authenticate(
        'Bearer token',
      ),
    ).rejects.toMatchObject({ code: 'google-sign-in-required' });
  });
});

describe('fail-closed live configuration', () => {
  const enabled = {
    ASSISTANT_ENABLED: 'true',
    ASSISTANT_BUDGET_CONFIRMED: 'true',
    ASSISTANT_DAILY_BUDGET_USD: '3',
    FIREBASE_PROJECT_ID: PROJECT,
    GROQ_API_KEY: 'test-server-secret',
  };
  it('requires all explicit live gates', () => {
    expect(readAssistantConfig(enabled)).toMatchObject({
      enabled: true,
      dailyBudgetMicroUsd: 3_000_000,
    });
    for (const key of Object.keys(enabled))
      expect(
        readAssistantConfig({ ...enabled, [key]: undefined }).enabled,
      ).toBe(false);
  });
  it.each(['0', '-1', '3.01', 'NaN', 'Infinity'])(
    'rejects a disabled or expanded budget %s',
    (budget) => {
      expect(
        readAssistantConfig({ ...enabled, ASSISTANT_DAILY_BUDGET_USD: budget })
          .enabled,
      ).toBe(false);
    },
  );
  it('rejects emulator credentials and local HTTP in production', () => {
    expect(
      readAssistantConfig({
        ...enabled,
        NODE_ENV: 'production',
        FIRESTORE_EMULATOR_HOST: 'localhost:8080',
        ASSISTANT_ALLOW_LOCAL_HTTP: 'true',
      }),
    ).toMatchObject({ enabled: false, allowLocalHttp: false });
    expect(
      readAssistantConfig({
        ...enabled,
        NODE_ENV: 'production',
        FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
      }).enabled,
    ).toBe(false);
  });
});
