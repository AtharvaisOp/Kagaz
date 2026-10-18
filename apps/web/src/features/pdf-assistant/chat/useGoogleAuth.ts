import { useEffect, useRef, useState } from 'react';
import {
  authenticationMessage,
  getAssistantAuth,
  getRedirectResult,
  onIdTokenChanged,
  signInGoogle,
  signOut,
  type User,
} from './firebaseAuth';

type AuthState =
  | {
      readonly status: 'checking' | 'signed-out' | 'unavailable';
      readonly user: null;
    }
  | {
      readonly status: 'signed-in';
      readonly user: User;
      readonly sessionEpoch: number;
    };

export function useGoogleAuth() {
  const [auth] = useState(() => {
    try {
      return getAssistantAuth();
    } catch {
      return null;
    }
  });
  const [state, setState] = useState<AuthState>({
    status: auth ? 'checking' : 'unavailable',
    user: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionEpoch = useRef(0);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    void getRedirectResult(auth).catch((cause: unknown) => {
      if (active) setError(authenticationMessage(cause));
    });
    const unsubscribe = onIdTokenChanged(
      auth,
      (user) => {
        if (!active) return;
        if (
          user &&
          !user.providerData.some(
            (provider) => provider.providerId === 'google.com',
          )
        ) {
          sessionEpoch.current += 1;
          setState({ status: 'signed-out', user: null });
          setError('AI Chat requires a verified Google sign-in.');
          void signOut(auth).catch(() => undefined);
          return;
        }
        if (!user) sessionEpoch.current += 1;
        setState(
          user
            ? { status: 'signed-in', user, sessionEpoch: sessionEpoch.current }
            : { status: 'signed-out', user: null },
        );
      },
      () => {
        if (active) {
          sessionEpoch.current += 1;
          setState({ status: 'signed-out', user: null });
          setError(
            'Your authentication state could not be verified. Sign in again.',
          );
        }
      },
    );
    return () => {
      active = false;
      sessionEpoch.current += 1;
      unsubscribe();
    };
  }, [auth]);

  const login = async (redirect = false) => {
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInGoogle(auth, redirect);
    } catch (cause) {
      setError(authenticationMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!auth) return;
    sessionEpoch.current += 1;
    // Immediately close the chat gate, even if network sign-out fails.
    setState({ status: 'checking', user: null });
    setError(null);
    try {
      await signOut(auth);
      setState({ status: 'signed-out', user: null });
    } catch (cause) {
      setError(authenticationMessage(cause));
      setState({ status: 'signed-out', user: null });
    }
  };

  return {
    ...state,
    error,
    busy,
    login,
    logout,
    // Check the observer's synchronous epoch, including sign-out and same-UID
    // sign-in events React might batch into a single render.
    isSessionCurrent: () =>
      state.status === 'signed-in' &&
      state.sessionEpoch === sessionEpoch.current &&
      auth?.currentUser?.uid === state.user.uid,
  };
}
