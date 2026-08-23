import { createClient } from '@supabase/supabase-js';
import { log } from './utils/logger';

/**
 * Supabase Client Configuration
 * 
 * SECURITY: Environment variables are REQUIRED in production.
 * Never commit credentials to version control.
 * 
 * Required environment variables:
 * - VITE_SUPABASE_URL: Your Supabase project URL
 * - VITE_SUPABASE_ANON_KEY: Your Supabase anonymous key
 */

// Validate environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// In production, environment variables are REQUIRED
if (import.meta.env.PROD) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing required environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in production.'
    );
  }
}

// In development, warn if missing but allow fallback for local testing
if (import.meta.env.DEV) {
  if (!supabaseUrl || !supabaseAnonKey) {
    log.warn(
      'Missing Supabase environment variables. Create a .env file in the project root with:\n' +
      'VITE_SUPABASE_URL=your_supabase_url\n' +
      'VITE_SUPABASE_ANON_KEY=your_supabase_anon_key\n\n' +
      'The app will not work without these credentials.',
      undefined,
      'supabaseClient'
    );
  }
}

// Final validation - throw error if still missing
if (!supabaseUrl || !supabaseAnonKey) {
  const errorMsg = 'Supabase configuration is missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables in your .env file.';
  console.error('❌', errorMsg);
  console.error('📝 Make sure your .env file exists at: f:\\NChat App\\NChat App\\.env');
  throw new Error(errorMsg);
}

// Log successful connection (only in dev, and only once)
if (import.meta.env.DEV && !(window as any).__supabase_logged) {
  console.log('✅ Supabase client initialized');
  (window as any).__supabase_logged = true;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  realtime: {
    // OPTIMIZED for WhatsApp-level speed
    params: { eventsPerSecond: 100 },        // Was 10 - Allow more events per second
    heartbeatIntervalMs: 15000,              // Was 30000 - Detect disconnection faster
    reconnectAfterMs: (tries: number) => {
      // Aggressive reconnect: 500ms, 1s, 2s, 3s max
      return Math.min(500 * Math.pow(2, tries), 3000);
    },
  },
  global: {
    headers: {
      'x-client-info': 'nchat-app',
    },
  },
  db: {
    schema: 'public',
  },
});
