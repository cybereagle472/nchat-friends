# NChat API — Cloudflare Worker backend

This replaces Supabase entirely:

| Supabase | Cloudflare (here) |
|---|---|
| Postgres | D1 (`migrations/0001_init.sql`) |
| Auth | Custom JWT auth (`src/routes/auth.ts`) |
| Realtime channels | Durable Object `RealtimeRoom` + WebSockets |
| Storage buckets | R2 bucket `nchat-media` |
| Edge Functions / PostgREST | This Hono app, deployed as a Worker |

**I cannot run any of the commands below for you** — this sandbox has no
network access to Cloudflare's API. Run these yourself (locally, or in any
environment that can reach `api.cloudflare.com`).

## 1. One-time setup

```bash
cd worker
npm install

# Log in to your Cloudflare account (opens a browser)
npx wrangler login

# Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create nchat-db

# Create the R2 bucket for media (avatars, images, voice notes, videos, status media)
npx wrangler r2 bucket create nchat-media

# Apply the schema to the new database
npm run db:migrate:remote
```

## 2. Secrets

```bash
# Any long random string — used to sign JWTs. Generate one with:
#   openssl rand -base64 48
npx wrangler secret put JWT_SECRET

# Optional, only needed once push notifications are wired up:
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

## 3. Deploy

```bash
npm run deploy
```

Wrangler will print your Worker's URL, e.g.
`https://nchat-api.your-subdomain.workers.dev`. Put that in:

- `worker/wrangler.toml` → `PUBLIC_API_URL` (used to build media URLs), then redeploy
- the frontend's `.env.local` → `VITE_API_URL`

## 4. Local development (optional)

```bash
npm run db:migrate:local   # apply schema to a local SQLite file
npm run dev                # wrangler dev, serves on http://localhost:8787
```

Point the frontend at it with `VITE_API_URL=http://localhost:8787` in
`.env.local` at the repo root.

## API surface implemented so far

- `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`
- `GET/PATCH /users/me`, `GET /users/:id`, `GET /users/`, `GET /users/username-available`, `POST /users/presence`
- `POST /friends/request`, `/friends/:id/respond`, `DELETE /friends/request/:id`, `GET /friends/requests`,
  `GET /friends/sent`, `GET /friends/`, `DELETE /friends/:friendId`, `POST /friends/block`, `/friends/unblock`,
  `GET /friends/blocked`
- `POST /groups`, `GET /groups/`, `GET/POST /groups/:id/members`, `DELETE /groups/:id/members/:userId`,
  `POST /groups/:id/leave`, `PATCH /groups/:id`, `GET/POST /groups/:id/messages`
- `GET /messages/with/:otherId`, `GET /messages/chats`, `POST /messages`, `PATCH /messages/:id`,
  `DELETE /messages/:id`, `POST /messages/:id/reaction`, `POST /messages/mark-read`
- `POST /calls`, `/calls/:id/signal`, `/calls/:id/answer`, `/calls/:id/end`, `GET /calls/history`
- `POST /status`, `GET /status/mine`, `GET /status/feed`, `POST /status/:id/view`, `GET /status/:id/views`, `DELETE /status/:id`
- `POST /media/upload` (multipart), `GET /media/file/*`, `DELETE /media/file/*`
- `GET /realtime/connect?room=...&token=...` — WebSocket upgrade for live updates

## Not yet wired up on the frontend

The Worker above is functionally complete for these domains, but only
`authService` and `profileService` have been rewritten on the frontend so far
(see `src/lib/apiClient.ts` and `src/lib/realtimeClient.ts` for the pattern).
Still to migrate off the Supabase stub:
`chatService`, `friendService`, `groupService`, `callService`, `groupCallService`,
`statusService`, `mediaService`, `typingService`, `privacyService`,
`notificationService`, `pushNotificationService`, `disappearingService`,
`encryptionService`.
