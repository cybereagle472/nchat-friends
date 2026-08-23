import { supabase } from '../supabaseClient';
import { UserProfile } from '../types';
import { log } from '../utils/logger';

export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  needsProfileSetup: boolean;
}

export const authService = {
  // Check current session and return auth state
  async checkSession(): Promise<AuthState> {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        log.error('Session check failed', sessionError, 'authService');
        return { isAuthenticated: false, user: null, needsProfileSetup: false };
      }

      if (!session?.user?.id) {
        return { isAuthenticated: false, user: null, needsProfileSetup: false };
      }

      // Get profile from database
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileError) {
        log.warn('Profile fetch failed, user may need setup', profileError, 'authService');
        return { isAuthenticated: true, user: null, needsProfileSetup: true };
      }

      if (profile && profile.full_name && profile.username && profile.avatar_url) {
        return { isAuthenticated: true, user: profile as UserProfile, needsProfileSetup: false };
      }

      return { isAuthenticated: true, user: null, needsProfileSetup: true };
    } catch (err) {
      log.error('Unexpected error in checkSession', err, 'authService');
      return { isAuthenticated: false, user: null, needsProfileSetup: false };
    }
  },

  // Sign up new user
  async signUp(email: string, password: string): Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean }> {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // This ensures the user gets a session immediately if email confirmation is disabled
          emailRedirectTo: window.location.origin,
          data: {
            email: email
          }
        }
      });

      if (error) {
        log.error('Signup error', error, 'authService');

        // Handle "Database error saving new user" - this means the trigger failed
        if (error.message.includes('Database error') || error.message.includes('database error')) {
          // Try to check if user was actually created despite the error
          const { data: existingSession } = await supabase.auth.getSession();
          if (existingSession?.session?.user) {
            // User was created, just the profile trigger failed - that's OK, profile setup will handle it
            return { success: true, needsEmailConfirmation: false };
          }
          return { success: false, error: 'Sign up failed. Please try again.' };
        }

        if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          return { success: false, error: 'Email already registered. Please login.' };
        }
        if (error.message.includes('rate limit') || error.message.includes('too many')) {
          return { success: false, error: 'Too many signup attempts. Please wait a few minutes.' };
        }
        return { success: false, error: error.message || 'Sign up failed' };
      }

      if (!data.user) {
        return { success: false, error: 'Sign up failed - no user returned' };
      }

      // Check if email confirmation is required
      // If session is null but user exists, email confirmation is needed
      if (!data.session && data.user.identities?.length === 0) {
        // User already exists but trying to sign up again
        return { success: false, error: 'Email already registered. Please login.' };
      }

      if (!data.session) {
        // Email confirmation is required
        return { success: true, needsEmailConfirmation: true };
      }

      // User is signed up and logged in (email confirmation disabled)
      // Ensure a basic profile entry exists (the profile setup screen will complete it)
      try {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: data.user.id,
            email: email,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'id', ignoreDuplicates: true });

        if (profileError) {
          log.warn('Profile creation warning (non-fatal)', profileError, 'authService');
        }
      } catch (profileErr) {
        // Non-fatal - profile setup will handle this
        log.warn('Profile upsert failed (non-fatal)', profileErr, 'authService');
      }

      return { success: true, needsEmailConfirmation: false };
    } catch (err: any) {
      log.error('Unexpected signup error', err, 'authService');
      return { success: false, error: err.message || 'An unexpected error occurred' };
    }
  },

  // Login existing user
  async login(email: string, password: string): Promise<{ success: boolean; user?: UserProfile; needsSetup?: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        log.error('Login error', error, 'authService');
        if (error.message.includes('Invalid login') || error.message.includes('Invalid credentials')) {
          return { success: false, error: 'Invalid email or password' };
        }
        if (error.message.includes('Email not confirmed')) {
          return { success: false, error: 'Please check your email and confirm your account first' };
        }
        if (error.message.includes('rate limit') || error.message.includes('too many')) {
          return { success: false, error: 'Too many login attempts. Please wait a few minutes.' };
        }
        return { success: false, error: error.message || 'Login failed' };
      }

      if (!data.user) {
        return { success: false, error: 'Login failed - no user returned' };
      }

      if (!data.session) {
        return { success: false, error: 'Login failed - no session created' };
      }

      // Check if profile exists and is complete
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileError) {
        log.warn('Profile fetch failed after login', profileError, 'authService');
        // Profile might not exist yet - user needs setup
        return { success: true, needsSetup: true };
      }

      if (profile && profile.full_name && profile.username && profile.avatar_url) {
        return { success: true, user: profile as UserProfile, needsSetup: false };
      }

      // Profile exists but is incomplete
      return { success: true, needsSetup: true };
    } catch (err: any) {
      log.error('Unexpected login error', err, 'authService');
      return { success: false, error: err.message || 'An unexpected error occurred' };
    }
  },

  // Logout
  async logout(): Promise<void> {
    await supabase.auth.signOut();
  },

  // Get current user ID
  async getCurrentUserId(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  },

  // Subscribe to auth changes
  onAuthChange(callback: (event: string, session: any) => void) {
    return supabase.auth.onAuthStateChange(callback);
  }
};
