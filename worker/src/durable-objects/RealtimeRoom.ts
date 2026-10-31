/**
 * RealtimeRoom — one Durable Object instance per "room" (a 1:1 conversation,
 * a group, a call, or a user's personal channel). This replaces Supabase
 * Realtime channels: clients open a WebSocket to a room, and the Worker
 * broadcasts events into that room (new message, typing, presence, call
 * signaling) whenever something happens via the REST routes.
 */
const OPEN = 1;

export class RealtimeRoom {
  private sockets: Set<WebSocket> = new Set();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal call from a Worker route: broadcast a JSON payload to everyone
    // currently connected to this room.
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.text();
      this.broadcast(payload);
      return new Response('ok');
    }

    // Client WebSocket upgrade.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (event) => {
      // Relay ephemeral, DB-less events (typing indicators, presence pings)
      // straight through to everyone else in the room.
      for (const ws of this.sockets) {
        if (ws !== server && ws.readyState === OPEN) {
          try {
            ws.send(event.data as string);
          } catch {
            this.sockets.delete(ws);
          }
        }
      }
    });

    const cleanup = () => this.sockets.delete(server);
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(payload: string) {
    for (const ws of this.sockets) {
      if (ws.readyState === OPEN) {
        try {
          ws.send(payload);
        } catch {
          this.sockets.delete(ws);
        }
      }
    }
  }
}
