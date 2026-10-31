# Cloudflare Setup Guide — step by step

This walks you through provisioning everything NChat's backend needs on
Cloudflare: D1 (database), R2 (media storage), a Durable Object (realtime),
and the Worker (API) itself. Do this from your own machine (or any shell
with internet access) — it **cannot** be run from the Arena sandbox, which
has no network path to Cloudflare.

Total time: ~10–15 minutes. Cloudflare's free tier covers all of this
comfortably for development and small-scale production.

---

## 0. Prerequisites

- A free Cloudflare account → https://dash.cloudflare.com/sign-up
- Node.js 18+ and npm installed locally
- This repo cloned/pulled to your machine (`git pull` your `arena/940244a7-nchat-friends` branch)

---

## 1. Install dependencies

```bash
cd nchat-friends/worker
npm install
```

This installs `wrangler` (Cloudflare's CLI) and `hono` locally — you don't
need a global install, you'll run everything through `npx wrangler ...` or
the `npm run ...` scripts already defined in `worker/package.json`.

---

## 2. Log in to Cloudflare

```bash
npx wrangler login
```

This opens a browser tab to authorize the CLI against your Cloudflare
account. Approve it, then come back to the terminal — it'll confirm you're
logged in.

Verify any time with:

```bash
npx wrangler whoami
```

---

## 3. Create the D1 database (replaces Postgres)

```bash
npx wrangler d1 create nchat-db
```

This prints something like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "nchat-db"
database_id = "a1b2c3d4-5678-90ab-cdef-1234567890ab"
```

Copy the `database_id` value and paste it into `worker/wrangler.toml`,
replacing `REPLACE_WITH_D1_DATABASE_ID`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "nchat-db"
database_id = "a1b2c3d4-5678-90ab-cdef-1234567890ab"   # ← your real id
```

---

## 4. Apply the database schema

The full schema (users, friends, groups, messages, calls, status, media,
etc.) lives in `worker/migrations/0001_init.sql`. Apply it to the real
(remote) database:

```bash
npm run db:migrate:remote
```

Confirm the tables exist:

```bash
npx wrangler d1 execute nchat-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

You should see `users`, `messages`, `groups`, `friend_requests`, etc.

---

## 5. Create the R2 bucket (replaces Supabase Storage)

```bash
npx wrangler r2 bucket create nchat-media
```

`worker/wrangler.toml` already references this bucket name (`nchat-media`)
under the `MEDIA` binding — no further config needed unless you rename it.

---

## 6. Set secrets

Never put these in `wrangler.toml` or commit them. Generate a strong random
signing secret for JWTs:

```bash
openssl rand -base64 48
```

Then set it:

```bash
npx wrangler secret put JWT_SECRET
# paste the generated value when prompted
```

Optional, only if/when you wire up push notifications:

```bash
# Use the keys already in your frontend .env.local, or generate new ones:
npx web-push generate-vapid-keys

npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

---

## 7. First deploy

```bash
npm run deploy
```

Wrangler will build and upload the Worker, then print your live URL:

```
https://nchat-api.<your-subdomain>.workers.dev
```

Copy that URL — you need it twice:

### 7a. Put it in `wrangler.toml` and redeploy

```toml
[vars]
PUBLIC_API_URL = "https://nchat-api.<your-subdomain>.workers.dev"
```

(This is used when building media URLs returned by `/media/upload`.)

```bash
npm run deploy
```

### 7b. Point the frontend at it

In the **repo root** (not `worker/`), edit `.env.local`:

```bash
VITE_API_URL=https://nchat-api.<your-subdomain>.workers.dev
```

---

## 8. Smoke-test the API directly

Before touching the frontend, confirm the backend works end to end with curl:

```bash
# Health check
curl https://nchat-api.<your-subdomain>.workers.dev/health
# → {"ok":true}

# Sign up a test user
curl -X POST https://nchat-api.<your-subdomain>.workers.dev/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
# → { "user": {...}, "access_token": "...", "refresh_token": "...", "expires_in": 900 }

# Use the access_token from above to call an authenticated route
curl https://nchat-api.<your-subdomain>.workers.dev/users/me \
  -H "Authorization: Bearer <paste access_token here>"
# → { "profile": {...} }
```

If all three work, your backend is live and correctly wired.

---

## 9. Run the frontend against it

From the repo root:

```bash
npm install          # if you haven't already
npm run dev
```

Open the app, sign up a new account, and go through Profile Setup — this
exercises `authService` and `profileService`, which are already rewired to
this API (see `src/lib/apiClient.ts`). Everything else (chats, groups,
calls, status, etc.) is still on the Supabase stub and will be migrated
next — see `worker/README.md` for the checklist.

---

## 10. (Optional) Local development without deploying every change

```bash
cd worker
npm run db:migrate:local   # applies schema.sql to a local SQLite file
npm run dev                # wrangler dev — serves on http://localhost:8787
```

Then in the repo root's `.env.local`:

```bash
VITE_API_URL=http://localhost:8787
```

`wrangler dev` hot-reloads the Worker on save, same as Vite does for the
frontend.

---

## 11. (Optional) Custom domain

In the Cloudflare dashboard → **Workers & Pages** → `nchat-api` →
**Settings** → **Domains & Routes** → **Add** → pick a domain/subdomain you
manage in that Cloudflare account (e.g. `api.yourapp.com`). Update
`PUBLIC_API_URL` in `wrangler.toml` and `VITE_API_URL` in `.env.local` to
match, then redeploy.

---

## 12. Where to see/manage your data

Cloudflare dashboard → **Workers & Pages**:
- **D1** → `nchat-db` → **Console** tab lets you run SQL queries directly in the browser
- **R2** → `nchat-media` → browse/delete uploaded files
- **Workers** → `nchat-api` → **Logs** (or `npx wrangler tail`) to watch live request logs
- **Durable Objects** are listed under the Worker's bindings; they don't need separate management

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Authentication error` on any wrangler command | Run `npx wrangler login` again |
| `D1_ERROR: no such table` | You deployed before running step 4 (`db:migrate:remote`) |
| CORS error in the browser console | Confirm `VITE_API_URL` has no trailing slash and matches the deployed URL exactly |
| `401 Unauthorized` on every request | `JWT_SECRET` wasn't set (step 6), or the frontend has a stale token — clear `localStorage` and log in again |
| WebSocket (realtime) won't connect | Check that `REALTIME` Durable Object binding deployed (`wrangler deploy` output lists it); browsers need `wss://`, which Cloudflare provides automatically on your `*.workers.dev`/custom domain |
| Media upload 404s on fetch | `PUBLIC_API_URL` in `wrangler.toml` doesn't match the real deployed URL — fix and redeploy (step 7a) |

---

## Quick reference — command cheat sheet

```bash
cd worker
npm install                    # once
npx wrangler login              # once
npx wrangler d1 create nchat-db # once — then paste id into wrangler.toml
npm run db:migrate:remote       # once (re-run if you add new migrations later)
npx wrangler r2 bucket create nchat-media   # once
npx wrangler secret put JWT_SECRET          # once
npm run deploy                  # every time you change worker/src/**
npx wrangler tail               # live logs while debugging
```
