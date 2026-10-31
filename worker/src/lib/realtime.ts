import type { Env } from '../types';

/** Canonical room id for a 1:1 conversation between two users (order-independent). */
export function roomIdFor(userA: string, userB: string): string {
  return `dm:${[userA, userB].sort().join(':')}`;
}

export function groupRoomId(groupId: string): string {
  return `group:${groupId}`;
}

export function callRoomId(callId: string): string {
  return `call:${callId}`;
}

export function userRoomId(userId: string): string {
  return `user:${userId}`;
}

/**
 * Send an event into a realtime room's Durable Object so any connected
 * WebSocket clients (open chat windows, typing indicators, etc.) get it
 * immediately. This is how "Supabase Realtime" style fan-out works here.
 */
export async function broadcastToRoom(env: Env, roomId: string, payload: unknown): Promise<void> {
  const id = env.REALTIME.idFromName(roomId);
  const stub = env.REALTIME.get(id);
  await stub.fetch('https://do/broadcast', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });
}
