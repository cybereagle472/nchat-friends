export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  REALTIME: DurableObjectNamespace;
  JWT_SECRET: string;
  PUBLIC_API_URL: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export type Variables = {
  userId: string;
};
