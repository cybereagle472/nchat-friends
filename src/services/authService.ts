import {
  apiFetch,
  ApiError,
  setAuthSession,
  clearAuthSession,
  getCurrentUserId as getStoredUserId,
  getStoredAuth,
  onAuthStateChange,
} from '../lib/apiClient';
import { profileService } from './profileService';
import { UserProfile } from '../types';
import { log } from '../utils/logger';

export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  needsProfileSetup: boolean;
  /**
   * The session itself is fine, but we couldn't confirm the profile after
   * retrying (server/network hiccup). Callers should show a "try again"
   * state instead of guessing — in particular, NEVER treat this the same as
   * needsProfileSetup, since that would send a fully set-up returning user
   * back through onboarding just because of a dropped request.
   */
  sessionError?: boolean;
}

export interface ProfileResolution {
  user: UserProfile | null;
  needsProfileSetup: boolean;
  /** Tokens are gone/invalid/revoked — treat as fully signed out. */
  sessionInvalid?: boolean;
  /** Couldn't reach the server after retrying; session itself is still good. */
  sessionError?: boolean;
}

interface AuthResponse {
  user: { id: string; email: string; full_name: string };
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function isProfileComplete(profile: UserProfile | null): profile is UserProfile {
  return !!(profile && profile.full_name && profile.username && profile.avatar_url);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// How many times (beyond the first try) to retry a profile fetch before
// giving up and surfacing sessionError. Short backoff — this only needs to
// smooth over a dropped request or a cold Worker/DB connection, not a real
// outage.
const PROFILE_FETCH_RETRIES = 2;

export const authService = {
  // Resolves what a logged-in user's profile state should be, distinguishing
  // "no profile yet" from "couldn't tell right now" from "session is dead" —
  // shared by checkSession, login, and the app's onAuthChange handler so all
  // three bootstrap paths treat errors the same, safe way.
  async resolveProfileState(userId: string): Promise<ProfileResolution> {
    for (let attempt = 0; attempt <= PROFILE_FETCH_RETRIES; attempt++) {
      try {
        const profile = await profileService.getProfileOrThrow(userId);
        if (isProfileComplete(profile)) {
          return { user: profile, needsProfileSetup: false };
        }
        return { user: null, needsProfileSetup: true };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          return { user: null, needsProfileSetup: false, sessionInvalid: true };
        }
        if (attempt < PROFILE_FETCH_RETRIES) {
          await sleep(350 * (attempt + 1));
          continue;
        }
        log.error('Could not load profile after retries — keeping session alive', err, 'authService');
        return { user: null, needsProfileSetup: false, sessionError: true };
      }
    }
    /* istanbul ignore next — unreachable, loop always returns */
    return { user: null, needsProfileSetup: false, sessionError: true };
  },

  // Check current session and return auth state
  async checkSession(): Promise<AuthState> {
    const userId = getStoredUserId();
    if (!userId) {
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
    }

    const resolution = await this.resolveProfileState(userId);
    if (resolution.sessionInvalid) {
      clearAuthSession();
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
    }
    return {
      isAuthenticated: true,
      user: resolution.user,
      needsProfileSetup: resolution.needsProfileSetup,
      sessionError: resolution.sessionError,
    };
  },

  // Real-time "is this email already registered" check for the Sign Up form
  // — lets the user find out before submitting the whole form. Fails open
  // (never reports a false "taken") so a network blip can't block signup.
  async checkEmailExists(email: string): Promise<{ exists: boolean; valid: boolean }> {
    try {
      return await apiFetch<{ exists: boolean; valid: boolean }>(
        `/auth/check-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
        { skipAuth: true }
      );
    } catch (err) {
      log.error('checkEmailExists error', err, 'authService');
      return { exists: false, valid: true };
    }
  },

  // Sign up new user (email + password only — Profile Setup screen fills in the rest)
  async signUp(
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean }> {
    try {
      const data = await apiFetch<AuthResponse>('/auth/signup', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      });
      setAuthSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
      return { success: true, needsEmailConfirmation: false };
    } catch (err) {
      log.error('Signup error', err, 'authService');
      const message = err instanceof ApiError ? err.message : 'Sign up failed';
      return { success: false, error: message };
    }
  },

  // Login existing user
  async login(
    email: string,
    password: string
  ): Promise<{ success: boolean; user?: UserProfile; needsSetup?: boolean; error?: string }> {
    try {
      const data = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      });
      setAuthSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });

      const resolution = await this.resolveProfileState(data.user.id);
      // A fresh login/token pair is already known-good at this point — if the
      // immediate profile lookup hiccups, don't fail the login over it; the
      // app-level onAuthChange listener will resolve it (with its own
      // retries) a moment later.
      return { success: true, user: resolution.user ?? undefined, needsSetup: resolution.needsProfileSetup };
    } catch (err) {
      log.error('Login error', err, 'authService');
      const message = err instanceof ApiError ? err.message : 'Login failed';
      return { success: false, error: message };
    }
  },

  // Logout
  async logout(): Promise<void> {
    const auth = getStoredAuth();
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: auth?.refresh_token }),
      });
    } catch {
      /* best-effort server-side revoke */
    }
    clearAuthSession();
  },

  // Get current user ID
  async getCurrentUserId(): Promise<string | null> {
    return getStoredUserId();
  },

  // Subscribe to auth changes — mirrors supabase.auth.onAuthStateChange's shape
  // ({ data: { subscription } }) so call sites don't need to change.
  onAuthChange(callback: (event: string, session: { user: { id: string; email: string } } | null) => void) {
    const subscription = onAuthStateChange(callback);
    return { data: { subscription } };
  },
};
