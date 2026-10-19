import { FirebaseError, initializeApp, getApps } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

export const AI_RETURN_KEY = 'kagaz:ai-chat-return';

let authInstance: Auth | null = null;

export function getAssistantAuth(): Auth | null {
  if (authInstance) return authInstance;
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  const app =
    getApps().find((candidate) => candidate.name === 'kagaz-auth') ??
    initializeApp({ apiKey, authDomain, projectId, appId }, 'kagaz-auth');
  const auth = getAuth(app);
  const emulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
  if (import.meta.env.DEV && emulator) {
    const url = new URL(emulator);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('The authentication emulator must use a loopback host.');
    }
    connectAuthEmulator(auth, url.origin);
  }
  authInstance = auth;
  return auth;
}

export function hasPendingAiReturn(): boolean {
  try {
    return sessionStorage.getItem(AI_RETURN_KEY) === '1';
  } catch {
    return false;
  }
}

export function consumeAiReturn(): boolean {
  const pending = hasPendingAiReturn();
  try {
    sessionStorage.removeItem(AI_RETURN_KEY);
  } catch {
    /* Storage may be disabled. */
  }
  return pending;
}

export async function signInGoogle(
  auth: Auth,
  redirect = false,
): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (redirect) {
    // Only a UI return marker is persisted, never document text or a question.
    sessionStorage.setItem(AI_RETURN_KEY, '1');
    await signInWithRedirect(auth, provider);
  } else {
    await signInWithPopup(auth, provider);
  }
}

export function authenticationMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/popup-closed-by-user':
        return 'Google sign-in was closed. Your PDF remains local.';
      case 'auth/popup-blocked':
        return 'This browser blocked the sign-in popup. Allow popups or use the sign-in redirect option.';
      case 'auth/unauthorized-domain':
        return 'Google sign-in is unavailable on this domain. The owner must authorize it in Firebase.';
      case 'auth/network-request-failed':
        return 'Google sign-in could not connect. Check your connection and try again.';
      case 'auth/user-token-expired':
      case 'auth/invalid-user-token':
        return 'Your Google session expired. Sign out and sign in again.';
      case 'auth/operation-not-allowed':
        return 'Google sign-in has not been enabled for this Firebase project.';
    }
  }
  return 'Kagaz could not verify Google sign-in. Try again or continue with local editing and search.';
}

export { getRedirectResult, onIdTokenChanged, signOut };
export type { User };
