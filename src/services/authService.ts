import { api, convex } from '../lib/convexClient';
import { getAuthBridge } from '../lib/authBridge';
import type { UserProfile } from '../types';

export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  needsProfileSetup: boolean;
}

function mapUser(
  u: {
    _id: string;
    name?: string;
    image?: string;
    email?: string;
    full_name?: string;
    username?: string;
    avatar_url?: string;
    bio?: string;
  } | null
): UserProfile | null {
  if (!u) return null;
  return {
    id: u._id,
    full_name: u.full_name ?? u.name ?? u.email?.split('@')[0] ?? 'User',
    username: u.username,
    email: u.email ?? '',
    avatar_url: u.avatar_url ?? u.image,
    bio: u.bio,
    is_online: false,
  };
}

async function fetchMyProfile(): Promise<UserProfile | null> {
  try {
    const user = await convex.query(api.users.currentUser);
    if (!user) return null;
    const mapped = mapUser(user as never);
    if (mapped && mapped.full_name) return mapped;
    return null;
  } catch {
    return null;
  }
}

async function isSignedIn(): Promise<boolean> {
  try {
    const bridge = getAuthBridge();
    if (bridge && !bridge.isLoading) return bridge.isAuthenticated;
    const user = await convex.query(api.users.currentUser);
    return !!user;
  } catch {
    return false;
  }
}

export const authService = {
  async checkSession(): Promise<AuthState> {
    try {
      // Wait briefly for the auth client to restore its persisted session
      // from localStorage before concluding the user is signed out.
      const bridge = getAuthBridge();
      if (bridge?.isLoading) {
        await new Promise<void>((resolve) => {
          let waited = 0;
          const timer = setInterval(() => {
            waited += 100;
            if (!bridge.isLoading || waited >= 3000) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      }

      if (!(await isSignedIn())) {
        return { isAuthenticated: false, user: null, needsProfileSetup: false };
      }

      const profile = await fetchMyProfile();
      if (profile) {
        const complete =
          !!profile.full_name && !!profile.username && !!profile.avatar_url;
        return {
          isAuthenticated: true,
          user: profile,
          needsProfileSetup: !complete,
        };
      }
      return { isAuthenticated: true, user: null, needsProfileSetup: true };
    } catch {
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
    }
  },

  async signUp(
    email: string,
    password: string
  ): Promise<{
    success: boolean;
    error?: string;
    needsEmailConfirmation?: boolean;
  }> {
    try {
      const bridge = getAuthBridge();
      if (!bridge) {
        throw new Error('Auth not ready yet — please try again');
      }
      await bridge.signIn('password', { email, password, flow: 'signUp' });
      return { success: true, needsEmailConfirmation: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes('already') ||
        msg.toLowerCase().includes('exists') ||
        msg.includes('Uniqueness')
      ) {
        return {
          success: false,
          error: 'Email already registered. Please login.',
        };
      }
      if (
        msg.toLowerCase().includes('rate limit') ||
        msg.toLowerCase().includes('too many')
      ) {
        return {
          success: false,
          error: 'Too many signup attempts. Please wait a few minutes.',
        };
      }
      return { success: false, error: msg || 'Sign up failed' };
    }
  },

  async login(
    email: string,
    password: string
  ): Promise<{
    success: boolean;
    user?: UserProfile;
    needsSetup?: boolean;
    error?: string;
  }> {
    try {
      const bridge = getAuthBridge();
      if (!bridge) {
        throw new Error('Auth not ready yet — please try again');
      }
      await bridge.signIn('password', { email, password, flow: 'signIn' });

      const profile = await fetchMyProfile();
      if (profile) {
        const complete = !!profile.username && !!profile.avatar_url;
        return { success: true, user: profile, needsSetup: !complete };
      }
      return { success: true, needsSetup: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('invalid')) {
        return { success: false, error: 'Invalid email or password' };
      }
      return { success: false, error: msg || 'Login failed' };
    }
  },

  async logout(): Promise<void> {
    try {
      const bridge = getAuthBridge();
      if (bridge) await bridge.signOut();
      else await convex.action(api.auth.signOut, {});
    } catch {
      /* ignore */
    }
  },

  async getCurrentUserId(): Promise<string | null> {
    try {
      const user = await convex.query(api.users.currentUser);
      return (user as { _id?: string } | null)?._id ?? null;
    } catch {
      return null;
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAuthChange(callback: (event: string, session: any) => void) {
    // Poll Convex auth state; call back on transitions.
    let lastSignedIn: boolean | null = null;
    const interval = setInterval(async () => {
      try {
        const signedIn = await isSignedIn();
        if (lastSignedIn === null) {
          lastSignedIn = signedIn;
          return;
        }
        if (signedIn !== lastSignedIn) {
          lastSignedIn = signedIn;
          if (!signedIn) {
            callback('SIGNED_OUT', null);
            return;
          }
          const user = await convex.query(api.users.currentUser);
          callback('SIGNED_IN', {
            user: {
              id: (user as { _id: string })._id,
              email: (user as { email?: string }).email,
            },
          });
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    const subscription = { unsubscribe: () => clearInterval(interval) };
    return { data: { subscription } };
  },
};
