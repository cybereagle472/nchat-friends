# CLAUDE.md

This file provides guidance to AI coding agents (Claude Code, Arena, etc.)
working in this repository.

## Project Overview

NChat is a production-grade messaging application: React 19 + TypeScript
frontend, backed by a Cloudflare Workers API (D1 + R2 + Durable Objects).
It competes with WhatsApp, Messenger, and IMO — real-time messaging,
voice/video calls (WebRTC), group chats, status/stories, and an
offline-first architecture.

The backend was originally built on Supabase; it is being migrated
in-place to a self-hosted Cloudflare stack (see `worker/`). Some
`src/services/*.ts` files still call the legacy `src/supabaseClient.ts`
shim — check `worker/README.md` for the exact migration checklist before
assuming a given service is fully cut over.

## Commands

```bash
# Frontend
npm run dev          # Start dev server on port 3000
npm run build        # TypeScript check + Vite production build
npm run type-check   # TypeScript type checking only
npm run lint         # ESLint (ts,tsx files, zero warnings)
npm run preview      # Preview production build

# Backend (run from worker/)
npm run dev                # wrangler dev — local Worker on :8787
npm run deploy              # wrangler deploy — ship to Cloudflare
npm run db:migrate:local    # apply migrations/*.sql to local D1
npm run db:migrate:remote   # apply migrations/*.sql to the real D1 database
```

## Architecture

### Directory Structure
```
src/
├── components/      # React components (Auth, Chats, ChatView, Groups, etc.)
│   └── ui/          # Radix-based shadcn/ui components
├── services/        # Business logic layer - singleton service objects
├── hooks/           # Custom React hooks (useChat, useGroupChat, etc.)
├── utils/           # Utilities (logger, validation, crypto, offlineStorage)
├── lib/             # apiClient.ts (REST to the Worker), realtimeClient.ts (WebSocket rooms)
├── styles/          # CSS files
├── types.ts         # Centralized TypeScript type definitions
├── supabaseClient.ts # Legacy Supabase client — only used by not-yet-migrated services
└── App.tsx          # Root component with auth flow and navigation

worker/
├── src/routes/            # REST endpoints: auth, users, friends, messages, groups, calls, status, media
├── src/durable-objects/   # RealtimeRoom — WebSocket hub per chat/group/user room
├── src/lib/               # jwt.ts, password.ts, realtime.ts (room-id helpers), id.ts
├── migrations/            # D1 (SQLite) schema
└── wrangler.toml          # Worker config: D1/R2/Durable Object bindings
```

### Key Patterns

**Services Layer**: All backend interactions go through service singletons in `src/services/`. Each service handles a domain (auth, chat, calls, groups, media, notifications). Services are exported from `src/services/index.ts`. Migrated services call `src/lib/apiClient.ts` (`apiFetch`/`apiUpload`); unmigrated ones still call `src/supabaseClient.ts` directly.

**Offline-First Messaging**: The `chatService` uses `offlineStorage` utilities to:
- Generate idempotent `client_message_id` for deduplication
- Queue messages locally when offline
- Sync automatically when connection restores
- Update UI optimistically before server confirmation

**Real-time Subscriptions**: `src/lib/realtimeClient.ts` opens one WebSocket per active room (DM, group, or per-user notification room) against the Worker's `/realtime/connect` endpoint, backed by the `RealtimeRoom` Durable Object. Used for:
- Live message delivery
- Typing indicators
- Presence (online/offline status)
- Incoming call notifications

**Custom Hooks**: Located in `src/hooks/`, these manage complex state:
- `useChat` / `useGroupChat`: Message list state, sending, real-time updates
- `useCall`: WebRTC call management
- `useSyncManager`: Offline sync coordination
- `useNotifications`: Push and in-app notifications

### Type System

All types are defined in `src/types.ts`. Key interfaces:
- `UserProfile`: User data
- `Message` / `GroupMessage`: Chat messages with types (text, image, voice, video, etc.)
- `Contact` / `ChatSession`: Chat list items
- `Group` / `GroupMember`: Group chat data
- `Call` / `CallSignal`: WebRTC call state

Worker route handlers in `worker/src/routes/*.ts` shape their JSON
responses to match these same interfaces, so the frontend doesn't need
adapter/mapping code.

### UI Components

Uses shadcn/ui components (Radix primitives + Tailwind). Located in `src/components/ui/`. Path alias `@/` maps to `src/`.

## Environment Variables

Frontend, in `.env.local` (see `.env.example`):
```
VITE_API_URL=https://your-worker-subdomain.workers.dev
VITE_VAPID_PUBLIC_KEY=   # optional, for Web Push
VITE_GIPHY_API_KEY=      # optional, for GIF picker
```

Worker secrets (set via `wrangler secret put` or the Cloudflare dashboard,
never committed):
```
JWT_SECRET
VAPID_PUBLIC_KEY   # optional
VAPID_PRIVATE_KEY  # optional
```

## Deploying the backend

See `worker/SETUP_GUIDE.md` (CLI/`wrangler`) or
`worker/DASHBOARD_SETUP_GUIDE.md` (Cloudflare dashboard only, no terminal).
