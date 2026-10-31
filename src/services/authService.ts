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

export const authService = {
  // Check current session and return auth state
  async checkSession(): Promise<AuthState> {
    try {
      const userId = getStoredUserId();
      if (!userId) {
        return { isAuthenticated: false, user: null, needsProfileSetup: false };
      }

      const profile = await profileService.getProfile(userId);
      if (isProfileComplete(profile)) {
        return { isAuthenticated: true, user: profile, needsProfileSetup: false };
      }
      return { isAuthenticated: true, user: null, needsProfileSetup: true };
    } catch (err) {
      log.error('Unexpected error in checkSession', err, 'authService');
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
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

      const profile = await profileService.getProfile(data.user.id);
      if (isProfileComplete(profile)) {
        return { success: true, user: profile, needsSetup: false };
      }
      return { success: true, needsSetup: true };
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
