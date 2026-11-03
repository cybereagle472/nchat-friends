# Cloudflare Dashboard Setup Guide (no CLI, phone-friendly)

This does everything through the Cloudflare **website/dashboard** — no
terminal, no `wrangler` commands on your device. It uses Cloudflare's
"Workers Builds" feature, which deploys straight from your GitHub repo
every time you push a commit. Works fine from a phone browser.

Your code is already on GitHub at:
`https://github.com/cybereagle472/nchat-friends`, branch
**`arena/940244a7-nchat-friends`**, in the `worker/` folder.

---

## Step 1 — Create the D1 database

1. Go to **dash.cloudflare.com** → log in.
2. In the left sidebar: **Storage & Databases** → **D1 SQL Database**
   (older dashboards: **Workers & Pages** → **D1**).
3. Tap **Create Database**.
4. Name it exactly: `nchat-db`
5. Leave location hint as default (or pick the region closest to you).
6. Tap **Create**.
7. On the database's page, copy the **Database ID** shown near the top
   (a long UUID like `a1b2c3d4-5678-90ab-cdef-1234567890ab`). You'll paste
   this in Step 3.

---

## Step 2 — Create the R2 bucket

1. Left sidebar → **R2 Object Storage**.
   - First time here, Cloudflare may ask you to enable R2 (free tier is
     fine, no card charge for normal usage levels).
2. Tap **Create bucket**.
3. Name it exactly: `nchat-media`
4. Leave defaults, tap **Create bucket**.

(No ID to copy — the bucket *name* is the identifier, and it already
matches what's in the code.)

---

## Step 3 — Put the D1 database ID into the code (via GitHub's web editor)

1. On your phone, open:
   `https://github.com/cybereagle472/nchat-friends`
2. Tap the branch dropdown (says "main") → switch to
   **`arena/940244a7-nchat-friends`**.
3. Navigate to `worker/wrangler.toml` and tap it to open the file.
4. Tap the **pencil (edit) icon** in the top right.
5. Find this line:
   ```
   database_id = "REPLACE_WITH_D1_DATABASE_ID"
   ```
   Replace `REPLACE_WITH_D1_DATABASE_ID` with the Database ID you copied
   in Step 1 (keep the quotes).
6. Scroll down, tap **Commit changes...** → commit directly to the
   `arena/940244a7-nchat-friends` branch → **Commit changes**.

---

## Step 4 — Connect the repo to a new Worker ("Workers Builds")

1. Dashboard → **Workers & Pages** (sometimes labelled **Compute (Workers)**).
2. Tap **Create** → **Workers** → look for **Import a repository** /
   **Connect to Git** (wording varies by account).
3. Authorize Cloudflare to access your GitHub account if prompted, then
   pick the **`nchat-friends`** repository.
4. Set these build settings:
   | Field | Value |
   |---|---|
   | Git branch | `arena/940244a7-nchat-friends` |
   | Root directory | `worker` |
   | Build command | *(leave blank)* |
   | Deploy command | `npx wrangler deploy` *(this is the default)* |
5. Tap **Save and Deploy**.

Cloudflare will now: clone your repo, `cd worker`, run `npm install`, then
`npx wrangler deploy` — which reads `worker/wrangler.toml` and
automatically provisions the D1, R2, and Durable Object bindings for you
(no manual "Add binding" clicking needed, since they're already declared
in the file you edited in Step 3).

Wait for the deploy to finish (progress shown on screen), then open the
Worker's **Overview** tab — you'll see a live URL like:

```
https://nchat-friends.<your-subdomain>.workers.dev
```

**Copy this URL** — you need it in Step 6.

---

## Step 5 — Add the JWT secret

Authentication won't work until this is set.

1. Open your Worker → **Settings** → **Variables and Secrets** (exact tab
   name may be "Variables & Secrets" or just "Variables").
2. Tap **Add** → **Secret** (make sure it's type *Secret*, not *Text*, so
   it's encrypted).
3. Name: `JWT_SECRET`
4. Value — use this ready-made random secret (or generate your own):
   ```
   RzsK6poC3d3WrCkWM5Z1MJxpAc+THZbpKHUS9nOpaFMWtmlYXH8n4QlfL5PmVAYp
   ```
5. Tap **Save** / **Deploy**. Saving a secret triggers a redeploy
   automatically.

(Skip `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` for now — those are only
needed later for push notifications.)

---

## Step 6 — Set the public URL and redeploy

1. Go back to GitHub, edit `worker/wrangler.toml` again (same way as
   Step 3).
2. Find:
   ```
   PUBLIC_API_URL = "https://nchat-friends.YOUR-SUBDOMAIN.workers.dev"
   ```
   Replace it with the **real URL** you copied in Step 4.
3. Commit directly to `arena/940244a7-nchat-friends`.

Pushing this commit automatically triggers a new deploy on Cloudflare
(that's the whole point of Workers Builds) — no extra steps.

---

## Step 7 — Load the database schema

1. Dashboard → **Storage & Databases** → **D1 SQL Database** → tap
   **nchat-db**.
2. Open the **Console** tab.
3. On GitHub, open `worker/migrations/0001_init.sql`, tap **Raw**, select
   all the text, and copy it (it's about 240 lines / 9 KB — a normal
   paste on a phone is fine).
4. Paste the whole thing into the D1 Console's query box.
5. Tap **Run** / **Execute**.
6. You should see confirmation that tables were created. Double check by
   running this in the same console afterwards:
   ```sql
   SELECT name FROM sqlite_master WHERE type='table';
   ```
   You should get back `users`, `messages`, `groups`, `friend_requests`,
   `calls`, `statuses`, etc. (21 tables total).

7. If you already ran `0001_init.sql` before (i.e. this isn't a brand new
   database), also open `worker/migrations/0002_privacy_extra.sql` on
   GitHub the same way, copy it, paste it into the same Console box, and
   tap **Run**. It just adds two columns the Privacy Settings screen
   needs (`about_visibility`, `online_status_enabled`) — safe to run even
   if you're not sure whether it's already applied, since a second
   `0001_init.sql` run would fail anyway (tables already exist) so you'd
   know you're on a fresh database if Step 6 above is the first time.

---

## Step 8 — Verify the bindings landed

1. Open your Worker → **Settings** → **Bindings** (or **Bindings** tab on
   Overview).
2. Confirm you see:
   - **D1 Database** → variable name `DB` → `nchat-db`
   - **R2 Bucket** → variable name `MEDIA` → `nchat-media`
   - **Durable Object** → variable name `REALTIME` → `RealtimeRoom`
3. If any is missing, tap **Add binding** and fill it in manually using
   those exact variable names, then redeploy (edit any line in
   `wrangler.toml` on GitHub and commit again to force a redeploy).

---

## Step 9 — Test it

Open this in your phone's browser (plain GET, works directly in any
browser):

```
https://nchat-friends.<your-subdomain>.workers.dev/health
```

You should see:
```json
{"ok":true}
```

That confirms the Worker, D1, and R2 are all live.

---

## Step 10 — Wire up the frontend and test signup

Once you've done the above, send me your Worker URL
(`https://nchat-friends.<your-subdomain>.workers.dev`) and I'll:
1. Update `VITE_API_URL` in the app's config to point at it.
2. Start the live preview so you can open the NChat app in your phone
   browser and actually sign up / log in through the real UI — a much
   easier test than crafting raw API requests from a phone.

---

## Notes specific to the dashboard-only path

- **No wrangler CLI was used anywhere above** — every step was either the
  Cloudflare dashboard or GitHub's built-in web file editor.
- Every time you edit `wrangler.toml` (or anything in `worker/`) on
  GitHub and commit to `arena/940244a7-nchat-friends`, Cloudflare
  automatically redeploys — that's what "Workers Builds" does. You don't
  need to manually trigger deploys again after Step 4.
- If a step's exact wording doesn't match what you see (Cloudflare
  reshuffles dashboard menus occasionally), look for the nearest
  equivalent — "Storage & Databases"/"Workers & Pages" and "D1"/"R2" are
  always there, just sometimes nested one level differently.
- Realtime (Durable Object) and media upload (R2) don't need any separate
  dashboard setup beyond what's above — they're wired entirely through
  the bindings in `wrangler.toml`.
