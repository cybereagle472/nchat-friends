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
