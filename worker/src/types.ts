export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  REALTIME: DurableObjectNamespace;
  JWT_SECRET: string;
  PUBLIC_API_URL: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  // Cloudflare Realtime TURN key (https://dash.cloudflare.com/?to=/:account/calls).
  // Optional — calls still work without it (free public STUN + a free
  // public TURN fallback are used instead), but a real TURN relay is
  // needed for calls to reliably connect when both people are on
  // different networks/behind restrictive NATs.
  CF_TURN_KEY_ID?: string;
  CF_TURN_KEY_API_TOKEN?: string;
}

export type Variables = {
  userId: string;
};
