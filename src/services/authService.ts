import { api } from '../lib/convexClient';
import { convex } from '../lib/convexClient';
import type { UserProfile } from '../types';

export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  needsProfileSetup: boolean;
}

function mapUser(u: {
  _id: string;
  name?: string;
  image?: string;
  email?: string;
  full_name?: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
} | null): UserProfile | null {
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
    // Profile is "complete" when full_name + username + avatar exist
    if (mapped && mapped.full_name) return mapped;
    return null;
  } catch {
    return null;
  }
}

export const authService = {
  async checkSession(): Promise<AuthState> {
    try {
      const profile = await fetchMyProfile();
      if (profile) {
        const complete =
          !!profile.full_name &&
          !!profile.username &&
          !!profile.avatar_url;
        return { isAuthenticated: true, user: profile, needsProfileSetup: !complete };
      }
      // Distinguish signed-in-but-no-profile vs signed-out
      try {
        const user = await convex.query(api.users.currentUser);
        if (user) {
          return { isAuthenticated: true, user: null, needsProfileSetup: true };
        }
      } catch {
        /* not signed in */
      }
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
    } catch {
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
    }
  },

  async signUp(
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean }> {
    try {
      await convex.action(api.auth.signIn, {
        provider: 'password',
        params: { email, password, flow: 'signUp' },
      });
      return { success: true, needsEmailConfirmation: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already') || msg.includes('exists')) {
        return { success: false, error: 'Email already registered. Please login.' };
      }
      if (msg.includes('rate limit') || msg.includes('too many')) {
        return { success: false, error: 'Too many signup attempts. Please wait a few minutes.' };
      }
      return { success: false, error: msg || 'Sign up failed' };
    }
  },

  async login(
    email: string,
    password: string
  ): Promise<{ success: boolean; user?: UserProfile; needsSetup?: boolean; error?: string }> {
    try {
      await convex.action(api.auth.signIn, {
        provider: 'password',
        params: { email, password, flow: 'signIn' },
      });
      const profile = await fetchMyProfile();
      if (profile) {
        const complete = !!profile.username && !!profile.avatar_url;
        return { success: true, user: profile, needsSetup: !complete };
      }
      return { success: true, needsSetup: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Invalid') || msg.includes('invalid')) {
        return { success: false, error: 'Invalid email or password' };
      }
      return { success: false, error: msg || 'Login failed' };
    }
  },

  async logout(): Promise<void> {
    try {
      await convex.action(api.auth.signOut, {});
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
    // Poll Convex auth state; call back on changes.
    let lastSignedIn: boolean | null = null;
    const interval = setInterval(async () => {
      try {
        const user = await convex.query(api.users.currentUser);
        const signedIn = !!user;
        if (lastSignedIn === null) {
          lastSignedIn = signedIn;
          return;
        }
        if (signedIn !== lastSignedIn) {
          lastSignedIn = signedIn;
          callback(
            signedIn ? 'SIGNED_IN' : 'SIGNED_OUT',
            signedIn ? { user: { id: (user as { _id: string })._id, email: (user as { email?: string }).email } } : null
          );
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    const subscription = { unsubscribe: () => clearInterval(interval) };
    return { data: { subscription } };
  },
};
