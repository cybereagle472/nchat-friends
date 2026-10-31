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
  if (auth) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    scheduleProactiveRefresh(auth.access_token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
    clearProactiveRefresh();
  }
  listeners.forEach((l) => l(event, auth ? { user: auth.user } : null));
}

export function setAuthSession(auth: StoredAuth) {
  writeAuth(auth, 'SIGNED_IN');
}

export function clearAuthSession() {
  writeAuth(null, 'SIGNED_OUT');
}

// --- Token lifetime management ---------------------------------------
//
// Access tokens are short-lived (15 min server-side). Rather than relying
// purely on "retry once we hit a 401", proactively refresh a little before
// expiry so: (a) REST calls essentially never hit a 401 in normal use, and
// (b) the realtime WebSocket — which authenticates once at connect time via
// a query param, not a header — always has a fresh token available the
// instant it needs to (re)connect, including after the tab was backgrounded
// long enough for the access token to lapse.

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    let base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function msUntilExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return null;
  return payload.exp * 1000 - Date.now();
}

let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearProactiveRefresh() {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

function scheduleProactiveRefresh(accessToken: string) {
  clearProactiveRefresh();
  const remaining = msUntilExpiry(accessToken);
  if (remaining === null) return;
  // Refresh a minute before it actually expires; never schedule tighter
  // than 2s so a clock-skewed/garbage exp can't cause a tight refresh loop.
  const delay = Math.max(remaining - 60_000, 2_000);
  proactiveRefreshTimer = setTimeout(() => {
    refreshAccessToken();
  }, delay);
}

// Pick up an existing session on page load/refresh (writeAuth only runs for
// sign-in/out/refresh events happening *after* this module is loaded).
if (typeof localStorage !== 'undefined') {
  const existing = readAuth();
  if (existing?.access_token) scheduleProactiveRefresh(existing.access_token);
}

// Mobile browsers routinely suspend timers while a tab/app is backgrounded
// (screen locked, app switched away from), so the scheduled refresh above
// may simply never fire while that's happening. Catch up the instant the
// app becomes visible again instead of waiting for something else to 401.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const auth = readAuth();
    if (!auth?.access_token) return;
    const remaining = msUntilExpiry(auth.access_token);
    if (remaining !== null && remaining <= 60_000) {
      refreshAccessToken();
    } else {
      scheduleProactiveRefresh(auth.access_token);
    }
  });
}

// Keep every open tab in sync: if one tab signs out, the rest should drop
// to the login screen immediately rather than silently keep acting on a
// dead session until their next request happens to 401. Likewise, if one
// tab signs in or rotates tokens, the others should pick up the fresh
// tokens/timer right away instead of overwriting them with a stale refresh.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    if (!e.newValue) {
      clearProactiveRefresh();
      listeners.forEach((l) => l('SIGNED_OUT', null));
      return;
    }
    try {
      const updated = JSON.parse(e.newValue) as StoredAuth;
      scheduleProactiveRefresh(updated.access_token);
      listeners.forEach((l) => l('TOKEN_REFRESHED', { user: updated.user }));
    } catch {
      /* ignore malformed payloads from another tab */
    }
  });
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
      scheduleProactiveRefresh(updated.access_token);
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
