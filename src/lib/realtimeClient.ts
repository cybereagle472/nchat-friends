/**
 * Realtime client (replaces Supabase Realtime channels).
 *
 * Opens one WebSocket per "room" against the Worker's Durable Object
 * (`/realtime/connect?room=...`), multiplexes multiple local subscribers
 * onto the same socket, and auto-reconnects with backoff.
 */
import { wsUrlForRoom } from './apiClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (data: any) => void;

class RoomConnection {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private room: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private closed = false;

  constructor(room: string) {
    this.room = room;
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(wsUrlForRoom(this.room));
      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
      };
      this.ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string);
          this.handlers.forEach((h) => h(data));
        } catch {
          /* ignore malformed frames */
        }
      };
      this.ws.onclose = () => this.scheduleReconnect();
      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
      this.connect();
    }, this.reconnectDelay);
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  release() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

const rooms = new Map<string, { conn: RoomConnection; refCount: number }>();

/** Subscribe to a room; returns an unsubscribe function. Connections are ref-counted and shared. */
export function joinRoom(room: string, handler: Handler): () => void {
  let entry = rooms.get(room);
  if (!entry) {
    entry = { conn: new RoomConnection(room), refCount: 0 };
    rooms.set(room, entry);
  }
  entry.refCount++;
  const unsubscribe = entry.conn.subscribe(handler);
  return () => {
    unsubscribe();
    entry!.refCount--;
    if (entry!.refCount <= 0) {
      entry!.conn.release();
      rooms.delete(room);
    }
  };
}

export function sendToRoom(room: string, data: unknown) {
  rooms.get(room)?.conn.send(data);
}

export function dmRoomId(userA: string, userB: string): string {
  return `dm:${[userA, userB].sort().join(':')}`;
}
export function groupRoomId(groupId: string): string {
  return `group:${groupId}`;
}
export function userRoomId(userId: string): string {
  return `user:${userId}`;
}
