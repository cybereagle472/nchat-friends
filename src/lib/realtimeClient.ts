/**
 * Realtime client for the Cloudflare Worker backend (replaces Supabase
 * Realtime channels).
 *
 * The Worker gives every logged-in user a personal room (`user:<id>`) and
 * fans out every event relevant to them into it — new/edited/deleted
 * messages, reactions, read receipts, friend requests/accepts, etc. So a
 * single WebSocket per session is enough for the whole app: open it once,
 * and let any service register interest in specific event `type`s.
 */
import { wsUrlForRoom, getCurrentUserId } from './apiClient';

export type RealtimeHandler = (payload: any) => void;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private userId: string | null = null;
  private handlers = new Map<string, Set<RealtimeHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByClient = false;

  connect(userId: string) {
    if (this.userId === userId && this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.disconnect();
    this.userId = userId;
    this.closedByClient = false;
    this.open();
  }

  private open() {
    if (!this.userId) return;
    try {
      const url = wsUrlForRoom(`user:${this.userId}`);
      const ws = new WebSocket(url);
      this.socket = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type) this.emit(data.type, data);
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onclose = () => {
        if (!this.closedByClient) this.scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByClient && this.userId) this.open();
    }, delay);
  }

  disconnect() {
    this.closedByClient = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.userId = null;
  }

  on(type: string, handler: RealtimeHandler): { unsubscribe: () => void } {
    // Make sure a connection exists even if connect() wasn't called yet
    // (e.g. a service subscribes before the app's top-level effect runs).
    const uid = this.userId || getCurrentUserId();
    if (uid) this.connect(uid);

    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);

    return {
      unsubscribe: () => {
        set?.delete(handler);
      }
    };
  }

  private emit(type: string, payload: any) {
    this.handlers.get(type)?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.error('[realtimeClient] handler error:', err);
      }
    });
  }
}

export const realtimeClient = new RealtimeClient();
