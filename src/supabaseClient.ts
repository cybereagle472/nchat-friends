import { createClient } from '@supabase/supabase-js';
import { log } from './utils/logger';

/**
 * Legacy Supabase client.
 *
 * NChat's backend is being migrated to Cloudflare (see /worker). Most
 * services now call `src/lib/apiClient.ts` instead of this file. A handful
 * of services are still mid-migration and import `supabase` from here —
 * this client exists only to keep those imports from crashing the app.
 *
 * IMPORTANT: this project no longer ships VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY, so this client is NOT a working Supabase
 * connection. It must never throw at import time (that would blank-screen
 * the entire app, since many modules import it eagerly) — any service that
 * still calls `supabase.*` will simply get a network/auth error at the
 * call site, which is expected until it's migrated too.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  log.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — this is expected, NChat now runs ' +
      'on the Cloudflare Worker API (see /worker). Any not-yet-migrated service that still calls ' +
      '`supabase.*` will fail at the call site rather than connecting to a real backend.',
    undefined,
    'supabaseClient'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  realtime: {
    params: { eventsPerSecond: 100 },
    heartbeatIntervalMs: 15000,
    reconnectAfterMs: (tries: number) => {
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
