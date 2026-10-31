/**
 * API client for the Cloudflare Worker backend (replaces supabaseClient.ts).
 *
 * Handles: token storage, auto-refresh on 401, JSON + multipart requests,
 * and a tiny auth pub/sub so services can emulate Supabase's
 * `onAuthStateChange` interface without rewriting every call site.
 */
import type { UserProfile } from '../types';

export const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:8787';

const STORAGE_KEY = 'nchat_auth_v1';

export interface StoredAuth {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; full_name?: string };
}

function readAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type AuthListener = (event: AuthEvent, session: { user: StoredAuth['user'] } | null) => void;
const listeners = new Set<AuthListener>();

export function onAuthStateChange(cb: AuthListener): { unsubscribe: () => void } {
  listeners.add(cb);
  return { unsubscribe: () => listeners.delete(cb) };
}

function writeAuth(auth: StoredAuth | null, event: AuthEvent) {
  if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((l) => l(event, auth ? { user: auth.user } : null));
}

export function setAuthSession(auth: StoredAuth) {
  writeAuth(auth, 'SIGNED_IN');
}

export function clearAuthSession() {
  writeAuth(null, 'SIGNED_OUT');
}

export function getStoredAuth(): StoredAuth | null {
  return readAuth();
}

export function getCurrentUserId(): string | null {
  return readAuth()?.user?.id ?? null;
}

export function getAccessToken(): string | null {
  return readAuth()?.access_token ?? null;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const auth = readAuth();
  if (!auth?.refresh_token) return null;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: auth.refresh_token }),
      });
      if (!res.ok) {
        writeAuth(null, 'SIGNED_OUT');
        return null;
      }
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      const updated: StoredAuth = { ...auth, access_token: data.access_token, refresh_token: data.refresh_token };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      listeners.forEach((l) => l('TOKEN_REFRESHED', { user: updated.user }));
      return data.access_token;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface ApiOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const auth = readAuth();
  const headers = new Headers(options.headers);
  if (!options.skipAuth && auth?.access_token) {
    headers.set('Authorization', `Bearer ${auth.access_token}`);
  }
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isForm && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && !options.skipAuth && auth?.refresh_token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<T>(path, { method: 'POST', body: form });
}

/** Builds the WebSocket URL for a given realtime room, including the auth token. */
export function wsUrlForRoom(room: string): string {
  const auth = readAuth();
  const base = API_BASE.replace(/^http/, 'ws');
  return `${base}/realtime/connect?room=${encodeURIComponent(room)}&token=${encodeURIComponent(
    auth?.access_token ?? ''
  )}`;
}

export type { UserProfile };
