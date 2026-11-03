/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_TURN_SERVER_URL?: string;
  readonly VITE_TURN_SERVER_USERNAME?: string;
  readonly VITE_TURN_SERVER_CREDENTIAL?: string;
  readonly VITE_GIPHY_API_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_VAPID_PRIVATE_KEY?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite.config.ts's `define` at build time — see the comment
// there for why this exists (verifying a deployment is actually serving
// the commit it claims to).
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
