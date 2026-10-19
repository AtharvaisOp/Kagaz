import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseAppSdk from 'firebase/app';
import type * as FirebaseAuthSdk from 'firebase/auth';

const sdk = vi.hoisted(() => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: 'kagaz-auth' })),
  getAuth: vi.fn(() => ({ name: 'real-sdk-auth-boundary' })),
  connectAuthEmulator: vi.fn(),
  signInWithPopup: vi.fn().mockResolvedValue(undefined),
  signInWithRedirect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/app', async (original) => ({
  ...(await original<typeof FirebaseAppSdk>()),
  getApps: sdk.getApps,
  initializeApp: sdk.initializeApp,
}));
vi.mock('firebase/auth', async (original) => ({
  ...(await original<typeof FirebaseAuthSdk>()),
  getAuth: sdk.getAuth,
  connectAuthEmulator: sdk.connectAuthEmulator,
  signInWithPopup: sdk.signInWithPopup,
  signInWithRedirect: sdk.signInWithRedirect,
}));

function configure() {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'public-web-config');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'demo-kagaz.firebaseapp.com');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-kagaz');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'public-app-id');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Google-only modular Firebase setup', () => {
  it('keeps AI unavailable without the owner’s complete Web App configuration', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    const { getAssistantAuth } = await import('./firebaseAuth');
    expect(getAssistantAuth()).toBeNull();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });

  it('initializes the named Firebase app once and connects only to an explicit development emulator', async () => {
    configure();
    vi.stubEnv('VITE_FIREBASE_AUTH_EMULATOR_URL', 'http://127.0.0.1:9099');
    const { getAssistantAuth } = await import('./firebaseAuth');
    expect(getAssistantAuth()).toBe(getAssistantAuth());
    expect(sdk.initializeApp).toHaveBeenCalledExactlyOnceWith(
      {
        apiKey: 'public-web-config',
        authDomain: 'demo-kagaz.firebaseapp.com',
        projectId: 'demo-kagaz',
        appId: 'public-app-id',
      },
      'kagaz-auth',
    );
    expect(sdk.connectAuthEmulator).toHaveBeenCalledExactlyOnceWith(
      sdk.getAuth.mock.results[0]?.value,
      'http://127.0.0.1:9099',
    );
  });

  it('never connects a production build to the authentication emulator', async () => {
    configure();
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FIREBASE_AUTH_EMULATOR_URL', 'http://127.0.0.1:9099');
    const { getAssistantAuth } = await import('./firebaseAuth');
    expect(getAssistantAuth()).not.toBeNull();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('rejects a remote development emulator host before trusting it', async () => {
    configure();
    vi.stubEnv(
      'VITE_FIREBASE_AUTH_EMULATOR_URL',
      'http://untrusted.example:9099',
    );
    const { getAssistantAuth } = await import('./firebaseAuth');
    expect(() => getAssistantAuth()).toThrow('loopback');
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('uses the actual Google provider for popup sign-in without storing a prompt or token', async () => {
    configure();
    const { getAssistantAuth, signInGoogle } = await import('./firebaseAuth');
    await signInGoogle(getAssistantAuth()!);
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);
    const provider = sdk.signInWithPopup.mock.calls[0]?.[1] as unknown as {
      providerId: string;
    };
    expect(provider.providerId).toBe('google.com');
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('redirect persists only a UI return marker and consumes it after the PDF is reopened', async () => {
    configure();
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      setItem: (key: string, value: string) => values.set(key, value),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    });
    const {
      getAssistantAuth,
      signInGoogle,
      hasPendingAiReturn,
      consumeAiReturn,
      AI_RETURN_KEY,
    } = await import('./firebaseAuth');
    await signInGoogle(getAssistantAuth()!, true);
    expect([...values]).toEqual([[AI_RETURN_KEY, '1']]);
    expect(sdk.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(hasPendingAiReturn()).toBe(true);
    expect(consumeAiReturn()).toBe(true);
    expect(hasPendingAiReturn()).toBe(false);
  });
});
