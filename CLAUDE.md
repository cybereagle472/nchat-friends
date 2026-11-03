# CLAUDE.md

This file provides guidance to AI coding agents (Claude Code, Arena, etc.)
working in this repository. Keep it accurate — update it whenever you make
a structural change (new top-level folder, removed legacy code, renamed
service, etc.) so the next agent session doesn't have to rediscover it.

## Project Overview

NChat is a production-grade messaging application: React 19 + TypeScript
frontend, backed by a Cloudflare Workers API (D1 + R2 + Durable Objects).
It's a full alternative to WhatsApp/Messenger/WeChat — real-time
messaging, voice/video calls (WebRTC), group chats, status/stories, and an
offline-first architecture.

The backend was originally built on Supabase and has been **fully
migrated** to a self-hosted Cloudflare stack (see `worker/`). There is no
Supabase code left anywhere in the repo — every service in `src/services/`
talks to the Worker API exclusively through `src/lib/apiClient.ts`. See
`worker/README.md` for the Supabase → Cloudflare feature mapping if you
need the historical context.

## Commands

```bash
# Frontend
npm run dev          # Start dev server on port 3000
npm run build        # TypeScript check + Vite production build
npm run type-check   # TypeScript type checking only
npm run preview      # Preview production build

# Backend (run from worker/)
npm run dev                # wrangler dev — local Worker on :8787
npm run deploy              # wrangler deploy — ship to Cloudflare
npm run typecheck           # TypeScript type checking only
npm run db:migrate:local    # apply migrations/*.sql to local D1
npm run db:migrate:remote   # apply migrations/*.sql to the real D1 database
```

> Note: `npm run lint` is defined in `package.json` but ESLint itself
> isn't currently installed as a dependency — running it will fail with
> "eslint: not found" until it's added. Use `npm run type-check` /
> `npm run build` to validate changes instead.

## Architecture

### Directory Structure
```
src/
├── components/      # React screens (Auth, Chats, ChatView, Groups, Settings, ...)
│                     # — plain Tailwind JSX throughout, no separate UI
│                     #   component library layer
├── services/        # Business logic layer — one singleton object per
│                     #   domain, each imported directly from its own file
│                     #   (there is no barrel/index.ts)
├── hooks/           # Custom React hooks: useAppData, useGroupChat,
│                     #   useKeyboardInset, useVisualViewportHeight
├── utils/           # Utilities: logger, validation, retry, offlineStorage,
│                     #   mediaUtils, errorTracking, presenceFormat, constants
├── lib/             # apiClient.ts (REST to the Worker), realtimeClient.ts
│                     #   (WebSocket rooms), webrtcMedia.ts (call media helpers)
├── styles/          # globals.css (Tailwind + design tokens)
├── types.ts         # Centralized TypeScript type definitions
└── App.tsx          # Root component with auth flow and navigation

worker/
├── src/routes/            # REST endpoints: auth, users, friends, messages,
│                           #   groups, calls, groupCalls, status, media, admin, privacy
├── src/durable-objects/   # RealtimeRoom — WebSocket hub per chat/group/user room
├── src/middleware/        # auth.ts — JWT verification middleware
├── src/lib/               # jwt.ts, password.ts, realtime.ts (room-id helpers),
│                           #   id.ts, presence.ts, privacy.ts
├── migrations/            # D1 (SQLite) schema, applied in order (0001, 0002, ...)
└── wrangler.toml          # Worker config: D1/R2/Durable Object bindings
```

### Key Patterns

**Services Layer**: All backend interactions go through service singletons
in `src/services/` (`chatService`, `groupService`, `authService`,
`friendService`, `callService`, `groupCallService`, `mediaService`,
`profileService`, `privacyService`, `statusService`, `typingService`).
Each is imported directly, e.g. `import { chatService } from
'../services/chatService'` — there's no barrel file. Every one of them
calls `src/lib/apiClient.ts` (`apiFetch`/`apiUpload`) to reach the Worker;
none of them talk to a database directly.

**Offline-First Messaging**: `chatService` (and `groupService` for group
chat) use `src/utils/offlineStorage.ts` to:
- Generate idempotent `client_message_id`s for deduplication
- Queue messages locally when offline
- Sync automatically when connection restores
- Update the UI optimistically before server confirmation

**Real-time Subscriptions**: `src/lib/realtimeClient.ts` opens one
WebSocket per active room (DM, group, or per-user notification room)
against the Worker's realtime endpoint, backed by the `RealtimeRoom`
Durable Object. Used for:
- Live message delivery
- Typing indicators
- Presence (online/offline status)
- Incoming call signaling

**Custom Hooks** (`src/hooks/`):
- `useAppData`: top-level app bootstrap/session data
- `useGroupChat`: group message list state, sending, real-time updates
- `useKeyboardInset` / `useVisualViewportHeight`: mobile on-screen-keyboard
  layout handling

Call signaling and voice/video media itself are handled directly inside
`CallModal.tsx` / `GroupCallModal.tsx` plus `src/lib/webrtcMedia.ts`, not
through a dedicated hook.

### Type System

All types are defined in `src/types.ts`. Key interfaces:
- `UserProfile`: User data
- `Message` / `GroupMessage`: Chat messages with types (text, image, voice, video, file, gif, etc.)
- `Contact` / `ChatSession`: Chat list items
- `Group` / `GroupMember`: Group chat data
- `Call` / `CallSignal` / `CallHistory`: WebRTC call state and history
- `Status` / `StatusView` / `StatusReply`: Status/stories data

Worker route handlers in `worker/src/routes/*.ts` shape their JSON
responses to match these same interfaces, so the frontend doesn't need
adapter/mapping code.

### UI

No external component library — every screen is hand-built with Tailwind
CSS classes directly in its `.tsx` file. (An earlier `src/components/ui/`
folder of unused shadcn/Radix primitives, along with ~30 npm packages that
only existed to support it, was removed as dead weight — don't reintroduce
that pattern; just use Tailwind classes inline like the rest of the
codebase.) Path alias `@/` maps to `src/`.

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
CF_TURN_KEY_ID             # optional, for reliable cross-network calls
CF_TURN_KEY_API_TOKEN      # optional, for reliable cross-network calls
```

## Deploying the backend

See `worker/SETUP_GUIDE.md` (CLI/`wrangler`) or
`worker/DASHBOARD_SETUP_GUIDE.md` (Cloudflare dashboard only, no terminal).

## Cloudflare Git-integration deploy settings (Workers Builds)

Both the frontend and the backend are connected to Cloudflare as separate
"Workers Builds" (Git-integrated) projects, each with its own Production
branch / Build command / Deploy command configured in the Cloudflare
dashboard (Settings → Build) — **not** in any file in this repo. Getting
these wrong fails silently in a way that's easy to misdiagnose as "my
code isn't pushed" when the code on GitHub is actually fine. The correct
settings, worked out the hard way once already:

| Project | Root directory | Build command | Deploy command |
|---|---|---|---|
| Frontend (serves `dist/`, static site) | `/` | `npm run build` | `npx wrangler deploy` |
| Backend/API (`worker/`, Hono on Workers) | `worker` | *(leave empty — nothing to build, `wrangler deploy` bundles the TS itself)* | `npx wrangler deploy` |

Both projects' **Production branch** should be `main`.

Two gotchas worth remembering if a deployment looks stuck or wrong:
- `npx wrangler preview` is **not** a deploy command — it's an unrelated
  beta command for ephemeral local-style previews and will fail with a
  "missing `previews` block" error. If a project's Deploy command field
  ever shows this, it's misconfigured; change it to `npx wrangler deploy`.
- Cloudflare's **"Retry deployment"** button reruns the *exact* historical
  deployment it's attached to — same branch, same commit it originally
  built from — regardless of whatever the Production branch setting
  currently says. Changing Production branch in Settings only affects the
  *next new* deployment triggered by an actual push; it does not retarget
  or re-run anything already in the Deployments list. If you've just
  changed the Production branch and need a fresh build from it, push a
  new commit (or use a "Create deployment" action, if the dashboard
  exposes one) rather than retrying an old entry.

## Verifying a deployment is actually running the commit you think it is

The frontend bakes its current git commit hash into the build at compile
time (see `vite.config.ts`'s `define` block + `__BUILD_COMMIT__` in
`src/vite-env.d.ts`) and shows it in **Settings → About** ("Version 2.0.0
· build xxxxxxx") and in the Settings screen's footer. Compare that hash
against `main`'s latest commit on GitHub — if they don't match, the
browser is looking at a stale build/cache or the deploy didn't actually
pick up the latest commit, which is a *deployment* problem, not a code
problem. This exists because of exactly that kind of confusion during
this app's glassmorphism work (see Change Log below) — "I don't see the
change" was, more than once, actually "the browser/deploy is still
serving an older commit," which was impossible to tell apart from an
actual code bug without a way to check what commit is literally running.
If you can't find this build string in a deployed build, that's step one
of diagnosing *anything* that "isn't showing up."

## Change Log

Kept so context isn't lost across sessions/conversations. Append new
entries here (most recent last) whenever a non-trivial round of work
lands — what changed, why, and the commit(s) it landed in.

- **Glassmorphism recipe adopted app-wide, in stages** (commits `ef4cc05`,
  `37436d1`, `de71bec`, plus this entry's commit): added a shared
  `.glass-card` utility to `globals.css` implementing a specific
  translucent-card recipe (6% white fill, blur(5px), 1px translucent
  border, layered box-shadow with insets, ::before/::after shimmer edge
  highlights), generalized to drop the original one-off fixed
  `width/height/border-radius` so it works as a reusable class. Applied,
  by design judgment (not literally everywhere), to: confirmation/alert
  dialogs that float over a dark blurred scrim (Block/Unfriend/Remove/
  Delete-message confirmations across ChatView, Discover, ProfileView,
  MessageActions, GroupMessageActions), the chat header overflow menu,
  the reply-preview banner, ChatView's empty-state card, the
  date-separator pill, the always-visible bottom nav bar in `App.tsx`,
  and the "nothing here yet" empty-state cards in Chats/Discover/Friends/
  Groups/History. Deliberately *not* applied to message bubbles, the
  message long-press menu, the forward-to dialog, the reactions picker,
  the edit-message modal, or brand-colored gradient headers/dense list
  rows — text-legibility or branding reasons in each case.
- **Found and fixed a real production-only bug that silently killed the
  blur() in every non-Safari browser** (commit `de71bec`): every
  `backdrop-filter` rule in `globals.css` was written as
  `backdrop-filter: ...; -webkit-backdrop-filter: ...;` (standard
  property first). This repo's production CSS minifier (Lightning CSS,
  used internally by `@tailwindcss/vite`) treats that specific order as
  two redundant declarations and silently **drops the standard
  `backdrop-filter` property**, keeping only the `-webkit-` prefixed one
  — which Chrome/Firefox/Edge don't understand at all. Confirmed directly
  by running a 2-line reproduction through `lightningcss` itself (see PR
  #5's description for the exact before/after). This wasn't new — it
  already affected the pre-existing `.glass`, `.glass-dark`, and
  `.chat-input-glass`/`.chat-input-inner` rules too — and never showed up
  in local dev because `vite dev` doesn't minify CSS, only a production
  build does. **Fix: always write `-webkit-backdrop-filter` before the
  standard `backdrop-filter`** — see the comment directly above `.glass`
  in `globals.css`. If any future `backdrop-filter` is added anywhere in
  that file, use that order or it will silently break in production.
- **Two separate Cloudflare Workers Builds projects had wrong dashboard
  Build/Deploy command settings**, found while debugging why none of the
  above was visible live, even once GitHub's `main` branch definitely had
  the code (verified byte-for-byte via the GitHub API): the frontend
  project's Deploy command was `npx wrangler preview` (an unrelated
  ephemeral-preview beta command, not a real deploy — always fails) and
  the backend project's Build command was `npm run build` despite
  `worker/package.json` having no such script. See the "Cloudflare
  Git-integration deploy settings" section above for the corrected
  values; both are now fixed in the Cloudflare dashboard (outside this
  repo, so not visible in git history).
- **Added a build-commit stamp** (this entry's commit) visible in
  Settings → About, specifically to make "is this deployment actually
  running the latest code" a 5-second check instead of a guessing game —
  see the section directly above this Change Log.
