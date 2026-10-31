# NChat

A production-grade, real-time messaging app — our own alternative to
WhatsApp / Messenger / WeChat. One-to-one and group chat, voice/video
calls, disappearing messages, status/stories, friend requests, media
sharing, and push notifications, built on a modern serverless stack we
fully own (no third-party BaaS lock-in).

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Radix UI (shadcn-style components) |
| Backend API | Cloudflare Workers ([Hono](https://hono.dev)) |
| Database | Cloudflare D1 (SQLite at the edge) |
| Realtime | Cloudflare Durable Objects (WebSocket rooms) |
| Media storage | Cloudflare R2 |
| Auth | Custom JWT (access + refresh tokens), PBKDF2 password hashing |

Everything backend-related lives in [`worker/`](./worker) and deploys as a
single Cloudflare Worker — no servers to manage, generous free tier, and
it scales globally by default.

## Features

- 1:1 and group messaging, offline-first with optimistic sends and local queueing
- Friend requests, blocking, presence ("online"/"last seen")
- Voice & video calls (WebRTC signaling) and group calls
- Status/stories with view tracking
- Disappearing messages, end-to-end-style message encryption helpers
- Media uploads (images, voice notes, video) via R2
- Push notifications (Web Push / VAPID) and in-app notification center
- Typing indicators, read receipts, privacy settings per contact

## Project layout

```
src/                  React app (components, hooks, services, utils)
  components/         UI screens (Chats, Groups, Calls, Status, Settings, Auth, ...)
  components/ui/      Radix-based design system primitives
  services/           One module per domain (chat, friends, groups, calls,
                       status, media, notifications, ...) — the only layer
                       allowed to talk to the backend
  hooks/               React hooks wrapping the services for components
  lib/                 apiClient.ts (REST) and realtimeClient.ts (WebSocket)
  types.ts             Shared TypeScript data contracts

worker/                Cloudflare Workers backend (the API)
  src/routes/          REST endpoints (auth, users, friends, messages,
                       groups, calls, status, media)
  src/durable-objects/ RealtimeRoom — WebSocket hub for live updates
  migrations/          D1 (SQLite) schema
  README.md            API reference + architecture notes
  SETUP_GUIDE.md        Deploy via the `wrangler` CLI
  DASHBOARD_SETUP_GUIDE.md  Deploy entirely from the Cloudflare dashboard (no CLI)
```

## Getting started (frontend)

```bash
npm install
cp .env.example .env.local   # point VITE_API_URL at your Worker (see below)
npm run dev                  # http://localhost:3000
```

## Getting started (backend)

The API needs to be deployed to Cloudflare before the app is usable. Pick
whichever guide matches how you like to work:

- [`worker/SETUP_GUIDE.md`](./worker/SETUP_GUIDE.md) — CLI-based (`wrangler`), fastest if you have a terminal
- [`worker/DASHBOARD_SETUP_GUIDE.md`](./worker/DASHBOARD_SETUP_GUIDE.md) — 100% Cloudflare dashboard + GitHub web UI, no CLI/terminal required (works from a phone)

Once deployed, set `VITE_API_URL` in `.env.local` to your Worker's URL.

## Status

Actively migrating off a legacy Supabase prototype onto the Cloudflare
stack above. Auth, user profiles, friends, messaging, groups, calls,
status, and media routes are live on the Worker API. A handful of
secondary services (encryption keys, disappearing-message settings, group
call signaling) are still being wired up — see `worker/README.md` for the
exact checklist.

## License

MIT
