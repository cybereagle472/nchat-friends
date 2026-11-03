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

## Full Project History (comprehensive)

This section is the "whole story" of the app, kept so a new session doesn't
have to reconstruct it from 140+ commits of git log. It's organized by era
and by feature area rather than strictly by commit order. For a day-by-day
account of *this agent's* recent sessions specifically (with PR numbers and
commit hashes), see the "Change Log" section further down — this section
is the bigger picture it feeds into.

### Origin and early stabilization

The project began life as a generated/edited prototype from an AI app
builder (commit history shows the first ~20 commits authored as
"Before:"/"Freebuff:" message pairs, a leftover artifact of that tool),
imported into this repo with a hand-built chat UI and a Supabase backend.
In that state almost nothing actually worked end-to-end: the Tailwind
build pipeline was serving a stale precompiled CSS snapshot instead of
building for real, `supabaseClient` threw at import time and blanked the
whole app whenever Supabase env vars were missing, profile-picture upload
was broken, and the Friends/Chat screens didn't update in real time. A
long stretch of early commits (`f675c97` through `3eab2d4`, `bfe977c`)
is entirely devoted to getting these fundamentals solid: fixing the build
pipeline, making `supabaseClient` fail gracefully, redesigning Profile
Setup and the photo cropper, and wiring Friends/Chat to data that
actually updates live.

### The Supabase → Cloudflare migration

The single biggest architectural event in the project's history: the
entire backend was **migrated off Supabase onto a self-hosted Cloudflare
stack** — Workers (Hono) for the API, D1 (SQLite) for the database, R2
for media storage, and Durable Objects for realtime WebSocket rooms.
Commits `3eab2d4` ("Make friends + chat actually work: migrate off dead
Supabase calls") through `d585ea9` ("migrate Status/Stories off dead
Supabase calls") and `5e4b521`/`84b7b89` ("Migrate Groups off the dead
Supabase client") show this happening feature-by-feature: each domain
(chat, friends, status, groups, privacy, calls) was cut over to the
Worker API one at a time, with `fd1b2aa` ("Sync full Cloudflare migration
state + real D1 database_id") and `5894d7c`/`e6d5a7a`/`def3474`/`7b2945b`
covering the actual Cloudflare project wiring (`wrangler.toml`, the real
D1 database ID, renaming the Worker project, pointing `PUBLIC_API_URL` at
the live Worker). **There is no Supabase code left in the repo today** —
every `src/services/*.ts` file talks exclusively to `src/lib/apiClient.ts`
→ the Worker API. `worker/README.md` documents the historical
Supabase-feature → Cloudflare-equivalent mapping for anyone who needs it.

### Feature build-out, by area

- **Auth & sessions**: persistent login/signup sessions, a real-time
  "is this email already taken" check during signup, and a full rebuild
  of the auth bootstrap flow to be cache-first (show the UI instantly
  from cached session data, reconcile with the server after) "like
  WhatsApp/Telegram/Messenger" (`cb45984`) instead of blocking on a
  network round-trip. Fixed a bug where returning users got bounced back
  to Profile Setup after the app resumed from background (`33d77bf`,
  `2856662`).
- **1:1 messaging**: offline-first sending with optimistic UI and local
  queueing (`src/utils/offlineStorage.ts`), instant chat list previews/
  ticks/unread badges (`97cfaf6`), and a long series of real-time-delivery
  correctness fixes — messages not appearing when a chat is freshly
  opened, messages vanishing due to an IndexedDB bug, unread badges
  flickering from a stale-refresh race (`1f98a9e`, `b10a8fb`, `d20820b`,
  `fc46270`). Online/offline presence, last-seen, and typing indicators
  were added and then tuned for accuracy (`06192cd`, `20e078a`).
- **Voice messages**: this feature went through by far the most
  iteration of anything in the app — well over a dozen dedicated commits
  (`390956d` through `ac3d5ab`, `87d3a99`, `da0e5c3`) fixing, in roughly
  this order: touch/gesture handling for slide-to-lock recording not
  firing on real phones at all, a full-chat re-render storm that made
  recording feel stuck, a MIME-type mismatch that silently failed every
  send, locked-panel layout overflow pushing the send button off-screen,
  a waveform that was always flat, a duration bug showing `Infinity:NaN`,
  first-tap latency, playback state getting permanently frozen after
  mount, audio bleeding between a new recording and old playback, and
  finally a seek race that reset the playhead to 0 mid-drag. The worker's
  media GET route was also fixed to support HTTP Range requests (206
  Partial Content; `334a8c8`) so voice/video scrubbing works at all.
- **Status/Stories**: text/photo/video updates with view tracking and
  replies, migrated off Supabase, then fixed for ordering bugs and a
  self-view-count bug (`c49a264`), auto-advance pausing correctly while
  the viewer list or reply box is focused (`8665ce7`), and made a true
  full-screen overlay (hiding the bottom tab bar, which was bleeding
  through) with the view-count/reply bar fixed on mobile layouts
  (`a07a7f4`, `72ee2f9`, `7a63ca3`).
- **Groups**: migrated off the dead Supabase client onto the Worker
  (`84b7b89`), then built out into a full management screen (members,
  media, settings; `5e4b521`). Iterated through several real bugs: group
  chat messages completely broken because a new `duration` column's
  INSERT wasn't backward-compatible (`cf4014c`), photos rendering as
  empty glass rectangles instead of the actual image (`64fbaba`), the
  composer replaced with the 1:1 chat's full glass-pill design including
  real voice recording (`d8a2070`), typing/voice-recording indicators
  added both in-chat and in the groups list (`d942721`), read receipts
  and accurate unread badges (`1be1a6f`), a stray "0" badge showing on
  fully-read groups (`a7dc896`), 3 delivery ticks showing at once
  (`1153f89`), and group list previews not showing the real sender name
  or type-aware message text (`c4c8417`). **Group voice/video calling**
  (mesh WebRTC, multiple participants) was added (`946a54d`) and then
  fixed for a join-notification race that blocked connecting and a blank
  local video preview (`b3af447`), and for falsely showing "in call" with
  a running timer before anyone had actually answered (`6170362`).
- **Calls (1:1)**: WebRTC voice/video calling migrated fully onto the
  Worker (`e3406a0`), with a long tail of correctness fixes: calls
  getting stuck on "Connecting..." forever (fixed twice, for two
  different root causes — subscribing to signaling too late, and not
  also checking `iceConnectionState`; `40228dc`, `ce00250`), audio
  defaulting to the loud speaker instead of the earpiece (`d1482a1`),
  false-decline reports and connected/connecting state races (`3ca69e1`),
  reduced call audio noise, a slide-to-answer gesture (added, then made
  actually smooth; `aeb6dc7`, `6801dd5`), and **Cloudflare Realtime TURN
  support** added for calls to work across different networks/NATs
  (`e14a571`, documented in `worker/README.md` as the
  `CF_TURN_KEY_ID`/`CF_TURN_KEY_API_TOKEN` optional secrets).
- **Friends, Discovery, Privacy & Blocking**: friend requests and
  discovery of new people, each contact's privacy settings, and blocking
  — Privacy Settings was migrated to the Worker and is actually enforced
  server-side, not just hidden client-side (`519eabe`).
- **Profile Preview**: tap any contact or group member anywhere in the
  app to see their profile — added as a half-height sheet (`be5ec15`),
  then redesigned: the oversized purple header was shrunk (`fb1a09f`),
  the overlapping-avatar header design was removed (`079edd6`), and it
  was finally made a full-screen page instead of a half-height sheet
  (`28298bf`) for a cleaner, more deliberate feel.
- **Group Info / header**: tapping a group chat's header now opens the
  full Group Info screen WhatsApp-style, replacing a dropdown that was
  unreliable (`ea9b291`), with an instant mute toggle and a more robust
  member-menu dropdown position (`700a100`).
- **Performance**: cut the initial JS bundle size by roughly 60% and
  overlapped message-send D1 writes with their realtime broadcast instead
  of doing them sequentially (`4375f12`); removed loading-spinner states
  for tab switches and opening a chat, matching WhatsApp's instant feel
  (`072f681`); fixed the splash screen flashing on every tab/screen
  switch (`8430291`).
- **UI/UX polish**: an animated low-poly mesh background for both 1:1 and
  group chat screens (`bed3694`), the message input bar redesigned to
  float with nothing visually stuck behind it (`de25731`), date
  separators and voice-note avatars (`1aa96d5`), a sliding marquee effect
  for long header names/status text (`2dce881`, `4c288ab`), compact
  duration-aware voice bubble sizing, edge-to-edge media bubbles, and a
  keyboard-inset fallback so the chat screen doesn't get covered by the
  on-screen keyboard (`useKeyboardInset`/`useVisualViewportHeight` hooks).
  Circular avatars were made consistent across the Friends/Find/History
  tabs (`355d2f3`).
- **Android**: a native Capacitor Android project was scaffolded
  (`b3afebc`) — `capacitor.config.ts` has `appId: 'com.nchat.friends'`,
  `webDir: 'dist'`, no `server.url` override (so a native build bundles a
  static snapshot of `dist/` rather than live-fetching the UI). A GitHub
  Actions workflow (`apk.yml`, "Build Android APK") exists to build it,
  but **as of this writing it has never actually been run** — see
  "Known gaps" below.
- **Repo hygiene**: an entirely unused `src/components/ui/` folder of
  shadcn/Radix UI primitives (48 files, zero imports anywhere in the
  app) was removed along with the ~30 npm packages that only existed to
  support it, shrinking installed packages from 306 to 173 (`4649e18`).
  The README was rewritten into a proper professional presentation
  (`7916475`, and again in this repo's current form) and `CLAUDE.md` was
  modernized to describe the Cloudflare stack instead of the old
  Supabase one (`b9b72f4`).
- **Glassmorphism design system** (the most recent major thread of work,
  spanning this session's PRs #1–#6 and this round's follow-up): a
  reusable `.glass-card` utility was added and applied across floating
  surfaces, a real production-only CSS-minifier bug that silently killed
  `backdrop-filter` in every non-Safari browser was found and fixed, two
  misconfigured Cloudflare dashboard deploy settings were found and
  corrected, a build-commit verification stamp was added, and (this
  round) the whole recipe was made significantly stronger/more robust.
  Full details are in the "Change Log" section below — that section is
  this thread's authoritative, chronological record.

### What's working (as of the last verified state)

Per `README.md`'s roadmap and the commit history above: auth, user
profiles, friends/discovery, 1:1 messaging (text/images/voice/video/
files/GIFs, offline queueing, reactions/replies/forwarding/edit/delete),
group chat (same message types, member management), 1:1 and group voice/
video calls with TURN fallback for cross-network connectivity, status/
stories with view tracking and replies, presence/typing/read-receipts,
privacy settings and blocking, and push notifications are all live
end-to-end against the Cloudflare Worker API. The frontend production
build and the worker's `tsc --noEmit` have been verified clean at every
PR merge recorded in the Change Log below.

### Known gaps / what's not working or unverified

- **`npm run lint` is defined but will fail** — ESLint itself isn't
  installed as a dependency. Use `npm run type-check`/`npm run build`
  instead (noted above under Commands).
- **The Android APK GitHub Actions workflow (`apk.yml`) has never been
  run in this repo** (confirmed via `gh run list --workflow=apk.yml`
  returning zero runs) — there is no APK artifact anywhere that was
  actually built from this repository's CI. Any native app a user is
  testing from another source (e.g. a third-party wrapper service) is
  not this repo's build output and its behavior/freshness can't be
  reasoned about from here.
- **Live-site visual verification is capability-limited from this
  environment**: this agent's tools can fetch and typecheck/build the
  source, and can confirm a live URL serves the correct rendered HTML
  content (via the page-fetching tool), but cannot load a live page's
  raw CSS bytes, computed styles, or anything DevTools-equivalent, and
  cannot drive a real browser to visually confirm an effect like
  glassmorphism blur actually renders. That verification step has to
  happen on a real device/browser, ideally with desktop DevTools
  available (phone-only testers can't use `view-source:` in Android
  Chrome's address bar — it's treated as a search query, not a
  navigation command).
- **Glassmorphism visibility on real devices**: despite the source being
  confirmed correct on GitHub and the build output confirmed correct
  locally multiple times, a user testing on an Android device (via a
  third-party native wrapper app, and separately via mobile Chrome)
  reported still not seeing any visible blur/tint effect as of the start
  of this round. This round's change (see Change Log) significantly
  strengthens the effect's opacity/blur/border and adds a `@supports`
  fallback specifically to resolve this regardless of the exact cause
  (perceptual subtlety vs. a genuine rendering/caching issue on that
  device) — pending the user's next visual confirmation.

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
- **Added a build-commit stamp** (commit `e5c3102`, PR #6) visible in
  Settings → About, specifically to make "is this deployment actually
  running the latest code" a 5-second check instead of a guessing game —
  see the section directly above this Change Log.
- **Build-commit stamp confirmed working end-to-end**: the user reported
  the live Settings screen showing "NChat v2.0.0 · build 4ff2bda",
  exactly matching `main`'s actual HEAD commit at the time — the first
  real confirmation that this deployment-freshness check works as
  designed.
- **Investigated continued "I still don't see the glass effect" reports
  despite the stamp matching** (this entry's round, no production bug
  found): the user sent screenshots from an Android app built via a
  third-party native-wrapper service (median.co), not from this repo's
  own build pipeline. Confirmed via `gh run list --workflow=apk.yml`
  that this repo's own Android APK GitHub Actions workflow has **never
  been run** — so that app isn't evidence about this codebase at all.
  The user separately re-tested in mobile Chrome directly and still
  didn't see the effect there either. Re-verified, for the second time
  independently, that the live `main` source on GitHub still has the
  correct `glass-card` class on the Block User dropdown
  (`src/components/ChatView.tsx`, byte-for-byte checked via the GitHub
  API). Confirmed the live Cloudflare deployment itself is reachable and
  serving the real app (fetched `https://nchat-friends-deploy.
  usa66486.workers.dev/` and got back the actual login screen content).
  Could not get further diagnostic data from the user's phone-only setup
  — no desktop DevTools available, and Android Chrome's address bar
  doesn't support `view-source:` (treats it as a search query) — so raw
  CSS bytes/computed styles on the live device were never directly
  inspectable from this environment.
- **Decision: stop chasing an unverifiable root cause, make the effect
  impossible to miss instead** (this entry's commit): rather than keep
  relitigating whether this is a caching/device-support issue versus a
  perceptual-subtlety issue, `.glass-card`, `.date-separator-pill`
  (`globals.css`) and `.chat-list-empty` (`Chats.tsx`, which duplicates
  the same recipe independently) were all substantially strengthened —
  background fill raised from a barely-there 6% white to 22% as the
  no-blur-support fallback, border opacity raised from 30% to 55%,
  box-shadow insets strengthened, and the blur itself raised from 5px to
  18px with saturate(150%) to match the visible strength of this app's
  older `.glass`/`.chat-input-glass` elements (24px/20px) instead of
  being the single faintest glass effect in the app. A `@supports
  ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))`
  block now layers the blur on top only where the browser/WebView
  actually supports it, so unsupporting environments still get a clearly
  visible translucent card rather than nothing. `.chat-list-empty`'s
  pre-existing `backdrop-filter`-before-`-webkit-backdrop-filter`
  ordering (the same minifier-unsafe order fixed everywhere else in
  `de71bec`) was also corrected while touching that rule. Verified via
  `npx tsc --noEmit` (root + `worker/`) and `npm run build`, and by
  grepping the built CSS bundle to confirm both the base rule and the
  `@supports`-gated stronger rule survived minification with the correct
  property order.
- **Found and fixed the actual code bug behind "the glass effect looks like
  a flat opaque color, no blur/tint at all"** (this entry's commit): four
  `.glass-card` elements — `ChatView.tsx`'s header overflow dropdown (the
  exact element the user had screenshotted as proof), `Discover.tsx`'s
  Unfriend confirmation, and both `MessageActions.tsx`'s and
  `GroupMessageActions.tsx`'s Delete Message confirmation — had the
  `animate-scale-in` entrance animation (animates `transform: scale()` +
  `opacity` via `@keyframes`) applied **directly on the same element**
  that also carries `backdrop-filter` via `.glass-card`. Animating
  transform/opacity on an element that simultaneously uses
  `backdrop-filter` is a well-documented trigger for real Chromium/
  Android-WebView compositing bugs, where the browser promotes the
  element onto its own compositing layer for the animation and the
  backdrop-filter's live backdrop sample gets "frozen" at an early/
  incorrect point — rendering as a flat, nearly opaque solid color with a
  crisp edge and zero blur bleed-through, instead of a live blurred/
  tinted backdrop. This matches, element-for-element, what was reported:
  broken on the animated dropdown/dialogs, not reported as broken on the
  always-visible bottom nav's `.glass-card` (which has no transform/
  opacity animation on the nav element itself). **Fix**: split each
  affected element into an outer wrapper (carries `animate-scale-in` +
  positioning/sizing, no `backdrop-filter`) and an inner, permanently
  static element (carries `.glass-card` + rounding only, never animated)
  — same visual entrance motion, but the backdrop-filter element itself
  is never subject to a transform/opacity animation. **If any future
  glass-card-style element needs an entrance animation, always put the
  animation on a wrapper, never directly on the element that has
  `backdrop-filter`** — this is now the established pattern; see the
  inline comments at each of the four fixed call sites.
- **Added a comprehensive, whole-project history section to this file**
  (the "Full Project History (comprehensive)" section above, this
  entry's commit) — covering the app's origin, the full Supabase→
  Cloudflare backend migration, every major feature area's build-out and
  bug-fix history (auth, 1:1 and group messaging, voice messages, status/
  stories, calls, groups, privacy/friends, profile preview, performance,
  UI polish, Android, repo hygiene, glassmorphism), what's currently
  working, and known gaps — reconstructed from the repository's full
  commit history (141 commits on `main`) plus this and prior sessions'
  merged PRs, at the user's request for "the full history and everything
  about the whole app."
- **Fixed two more real bugs surfaced once the glass effect itself
  started actually rendering** (user feedback after the previous entry's
  fix went live): (1) `ChatView.tsx`'s chat header was `relative z-10`,
  tied with the message list right below it which is *also* `relative
  z-10` — since both are siblings and the message list comes later in
  the DOM, the tied z-index meant the message list painted on top of the
  *entire header*, including the header's own "Block User" overflow
  dropdown (which has `z-50`, but only relative to its own parent's
  stacking context — a child z-index can't lift its whole ancestor
  stacking context above an equal/higher sibling context). Fix: raised
  the header to `z-20`, matching the convention `GroupChatView.tsx`'s
  header already used (and never had this bug). (2) The message
  long-press action menu's (`MessageActions.tsx` / `GroupMessageActions.
  tsx`, which duplicate this logic) on-screen clamping used
  `window.innerWidth`/`innerHeight`, measured once with no `resize`
  listener, which on some mobile browsers reported a stale/inflated
  value and let the menu render partially or fully off the right edge of
  the screen, looking oversized and cut off. Fix: switched the clamp
  math to `document.documentElement.clientWidth/clientHeight` (re-run on
  `resize` too), added a hard `max-width` cap on the menu itself so it's
  physically incapable of exceeding the viewport width regardless of any
  future measurement bug, shrank the quick-reaction row's button
  size/padding so it fits more comfortably on narrow phone screens, and
  made that row horizontally scrollable as a last-resort fallback instead
  of ever overflowing. Also added a global `html, body { overflow-x:
  hidden }` safety net so any future mispositioned fixed/absolute popup
  can't widen the whole page's layout viewport the way this one did.
