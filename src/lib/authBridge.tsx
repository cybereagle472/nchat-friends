/**
 * AuthBridge — captures the official Convex auth actions into a module
 * singleton so plain-TS services (authService) can use the exact same
 * token-persisting code path as React components.
 *
 * Rendered inside <ConvexAuthProvider> in main.tsx. Without this, calling
 * api.auth.signIn directly would discard the returned tokens and sessions
 * would never persist across reloads.
 */

import { useEffect } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth } from 'convex/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignInFn = (...args: any[]) => Promise<unknown>;

interface AuthBridgeState {
  signIn: SignInFn;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}

let state: AuthBridgeState | null = null;

export function getAuthBridge(): AuthBridgeState | null {
  return state;
}

export function AuthBridge() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    state = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signIn: signIn as SignInFn,
      signOut: signOut as () => Promise<void>,
      isAuthenticated,
      isLoading,
    };
    return () => {
      // Keep last known values on unmount (StrictMode double-mounts).
      if (state) {
        state.isAuthenticated = isAuthenticated;
        state.isLoading = isLoading;
      }
    };
  }, [signIn, signOut, isAuthenticated, isLoading]);

  return null;
}
