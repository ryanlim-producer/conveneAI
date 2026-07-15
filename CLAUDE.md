# conveneAI — Infrastructure & Project Context

> **Rule:** Any change to infrastructure (server, DB, S3, DNS, ports, env vars, PM2, nginx, Telegram webhook, AWS) must be reflected in this file. This is the single source of truth for the multi-interface architecture.

---

## Production Deployment

The **primary UI** is the deployed instance on Hetzner. When the user refers to "the app", "my recordings", "my account", "login", or "the UI" — they mean this deployment, NOT localhost.

| Item | Value |
|---|---|
| **URL** | `https://5.223.84.152.sslip.io/conveneai` (moved from root 2026-07-13) |
| **Root path** | `https://5.223.84.152.sslip.io/` serves a static "Server Catalogue" page from `/srv/www` (links to `/conveneai` and `/blog`); `/blog` is static files from `/srv/blog` |
| **Base path** | Next.js `basePath: "/conveneai"` in `next.config.ts`. Client fetch/EventSource/anchor URLs are NOT auto-prefixed — they must use `api()` from `lib/api-path.ts` (base path inlined via `NEXT_PUBLIC_BASE_PATH`) |
| **Server** | Hetzner VPS — `root@5.223.84.152` |
| **SSH key** | `~/.ssh/id_ed25519` (copy also in `infra/.ssh/`, gitignored) |
| **Code path** | `/srv/asisvoz` — ⚠️ NOT a git repo; deploy by rsync/scp from local, then `npm run build && pm2 restart asisvoz` |
| **Active database** | `/srv/asisvoz/data/conveneai.db` (SQLite, WAL mode, better-sqlite3) |
| **Process manager** | PM2, process name `asisvoz`, runs as root (`pm2-root` systemd unit) |
| **Reverse proxy** | nginx, site `asisvoz` (copy in `infra/nginx-asisvoz.conf`), `proxy_buffering off` on `/conveneai/api/queue` |
| **TLS** | Let's Encrypt cert on `5.223.84.152.sslip.io`, auto-renew timer |
| **Backup** | Daily 3am cron — sqlite backup to `/srv/backups/`, 14-day retention |
| **Telegram webhook** | `https://5.223.84.152.sslip.io/conveneai/api/telegram/webhook` |
| **Node version** | 22.23.1 |

### ⚠️ CRITICAL: Two databases on production

The server has **two** SQLite databases. Only ONE is active:

| File | Status | Used by app? |
|---|---|---|
| `/srv/asisvoz/data/conveneai.db` | **ACTIVE** — the app reads/writes this | ✅ YES |
| `/srv/asisvoz/data/asisvoz.db` | **LEGACY** — old v1 data, do NOT query | ❌ NO |

When checking production data, always query `conveneai.db`, never `asisvoz.db`. The old DB still exists on disk for reference but is NOT connected to the running app.

### PM2 commands (run on server)

```bash
pm2 status                    # Check if asisvoz is running
pm2 restart asisvoz           # Restart after DB changes
pm2 logs asisvoz --lines 20   # Recent logs
```

### App startup

```bash
ssh root@5.223.84.152 "cd /srv/asisvoz && pm2 restart asisvoz"
```

PM2 runs `npm start` (Next.js production mode, port 3000 internally, nginx proxies from 443).

---

## Multi-Interface Architecture

conveneAI has **three interfaces** to the same backend:

| Interface | Platform | Details |
|---|---|---|
| **Web UI** | Next.js 16 (App Router) | `https://5.223.84.152.sslip.io/` |
| **Desktop app** | Tauri (Rust + React) | `desktop/` directory, macOS target |
| **Telegram bot** | Bot API | Webhook → `/api/telegram/webhook` |

All three share the same database, S3 bucket, and API routes.

---

## Database Schema

`/srv/asisvoz/data/conveneai.db` — SQLite (WAL mode, foreign keys ON):

```
users              — id, email (UNIQUE), password_hash (bcryptjs), created_at
user_sessions      — id, user_id (FK→users), token (UNIQUE), created_at, expires_at
recordings         — id, user_id (FK→users), job_id (FK→jobs), filename, source,
                     duration_seconds, speaker_count, s3_key, transcript_text,
                     segments_json, action_items_json, speaker_map_json,
                     model_used, cost_usd, group_name, group_id (FK→groups), created_at
jobs               — id, user_id (FK→users), recording_id (FK→recordings), status,
                     source, s3_key, filename, language, error_message,
                     model_used, attempts, created_at, started_at, completed_at
groups             — id, user_id (FK→users), name, created_at, UNIQUE(user_id, name)
chat_messages      — id, recording_id (FK→recordings), user_id (FK→users),
                     role (user|assistant), content, created_at
user_settings      — user_id (FK→users), deepgram_model, actions_llm_model,
                     chatbot_llm_model, created_at, updated_at
api_keys           — id, user_id (FK→users), provider, encrypted_key (AES-256-GCM), created_at
telegram_links     — id, user_id (FK→users), telegram_user_id, telegram_chat_id, created_at
link_codes         — code, user_id (FK→users), created_at
```

**Key relationship:** `recordings.job_id` → `jobs.id`, `jobs.recording_id` → `recordings.id` (circular FK — recordings inserted first with NULL job_id, then job inserted, then recording updated with job_id).

---

## AWS / S3

| Item | Value |
|---|---|
| **Bucket** | `asisvoz-audio-343268907530` |
| **Region** | `ap-southeast-1` |
| **AWS account** | 343268907530 |
| **IAM user** | `s3-admin` |
| **Profile** | `asisvoz` in `~/.aws/credentials` |
| **Lifecycle** | 90-day expiry on `uploads/` prefix |
| **Public access** | Blocked |
| **Key format** | `uploads/<user_id>/<uuid>.<ext>` |

AWS creds are also in `.env` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`).

---

## Auth System

- **Framework:** bcryptjs (12 rounds) for password hashing
- **Sessions:** 30-day TTL, stored in `user_sessions` table, cookie name `conveneai-auth`
- **Cookie:** httpOnly, sameSite=lax, secure in production
- **Env:** `INSECURE_COOKIES=1` disables secure flag (used for bare-IP deploys)

---

## Local Development

| Item | Value |
|---|---|
| **Dev server** | `npm run dev` (Next.js on port 3000 by default) |
| **⚠️ Port conflict** | Port 3000 is usually occupied by `praxi` (another project). Use **port 3100** for conveneAI locally: `npx next dev --port 3100` |
| **Local DB** | ❌ No local SQLite DB should exist. All data lives on production. Local DBs were deleted 2026-07-13. |
| **Tests** | `npm test` (vitest), `npx playwright test` (E2E with real API keys), `cd desktop && npx vitest run`, `cd desktop/src-tauri && cargo test` |
| **E2E fixture** | `tests/browser/fixtures/meeting.mp3` (TTS-generated) |

---

## Known Gotchas

1. **Stale nftables NAT rules** — The VPS had NAT rules redirecting port 80→8001. These were removed 2026-07-07 but are NOT persisted. If port 80 ever "refuses" connections, check `nft list ruleset` first.

2. **Truncated AWS secret** — The user's copy-path sometimes truncates the secret key. It must be exactly 40 characters. If `SignatureDoesNotMatch`, verify the key length before debugging anything else.

3. **Two databases on production** — Always query `conveneai.db`, not `asisvoz.db`. The old DB is a vestige of the v1→v2 rename.

4. **Port 8000 on VPS** — A localhost-only Python service on `:8000` belongs to another project. Leave it alone.

5. **No local databases** — Local `data/*.db` files were purged 2026-07-13. If a local dev server creates a new DB, it will be empty with no user data.

---

## ⚠️ Downstream Impact Checklist — Route / Config Changes

> **Rule:** Before merging any change that touches a URL path, API route, base path, nginx config, or env var, check **all three interfaces**. The web UI is only one of three — the desktop app and Telegram bot depend on the same routes and will silently break if not updated.

### When changing a route or base path, check:

| # | Downstream | What to verify |
|---|---|---|
| 1 | **Desktop app (Tauri)** | `api_url` in `desktop/src-tauri/src/config.rs` and `desktop/src/App.tsx` — these are compiled into the macOS binary. Also check the **user's local settings file** at `~/Library/Application Support/conveneAI/conveneai-settings.json` (and legacy `~/Library/Application Support/AsisVoz/asisvoz-settings.json`) — the desktop app reads its API URL from here, and it does NOT auto-update when the server changes. |
| 2 | **Desktop app (Rust API calls)** | Every API call in `desktop/src-tauri/src/api.rs` constructs URLs as `{api_url}/api/<route>` — if `api_url` doesn't include the base path, requests go to nginx's static catalogue (404). |
| 3 | **Telegram webhook** | The webhook URL is registered on Telegram's servers via `setWebhook`. Changing the route or adding a base path requires re-registering: `curl -s 'https://api.telegram.org/bot<TOKEN>/setWebhook?url=<NEW_URL>&secret_token=sha256(<TOKEN>)'`. Verify with `getWebhookInfo`. |
| 4 | **nginx config** | `infra/nginx-asisvoz.conf` and the live `/etc/nginx/sites-enabled/asisvoz` on the server must route the new paths. After changing, run `nginx -t && systemctl reload nginx`. |
| 5 | **Client-side fetch URLs** | Every `fetch()` / `EventSource` / `<a href>` in the web UI must use `api()` from `lib/api-path.ts` — Next.js `basePath` does NOT auto-prefix hand-written URLs. Only `next/link` and router navigation are auto-prefixed. |
| 6 | **User's local settings files** | After a base path change, existing desktop app users have a stale `api_url` in their local JSON settings. Either manually update it (as done 2026-07-14) or handle the redirect server-side. |
| 7 | **Temp audio files (desktop app)** | The desktop app deletes WAV/MP3 temp files immediately after upload attempts regardless of outcome (`desktop/src-tauri/src/lib.rs:367-368`). If the upload fails because of a wrong API URL, the recording is **permanently lost** — there is no retry queue or local cache. |

### Case Study: `/conveneai` Base Path (2026-07-13/14)

On 2026-07-13 the app was moved from the root path to `/conveneai` (commit `d8039aa`). Two downstream interfaces broke silently and weren't discovered until 2026-07-14:

**Telegram bot** — The webhook URL was updated in nginx, but the `secret_token` on Telegram's side was never re-registered. Every webhook request returned `401 Unauthorized` for ~24 hours. The nginx access log showed 20+ rejected POSTs from Telegram's IP. Fix: re-registered webhook with `setWebhook?url=...&secret_token=sha256(botToken)`. The pending message was immediately delivered and processed.

**Desktop app** — The source code default `api_url` (`config.rs`) and the user's local settings file both had `https://5.223.84.152.sslip.io` without `/conveneai`. Uploads went to `/api/upload` which nginx routed to the static catalogue (404). No requests appeared in nginx after the base path change — the user hadn't attempted recording today, but any future attempt would silently fail with temp files deleted. Fix: updated `config.rs`, `App.tsx`, and the user's two local `settings.json` files to include `/conveneai`.

**Lesson:** A one-line base path change in `next.config.ts` + nginx requires coordinated updates across 3 codebases (Next.js, Tauri/Rust, Telegram API) and 2 local files on the user's Mac. None of these have automated tests for the integration — the only signal is the user noticing recordings don't appear.

---

## Architecture Docs

- `specs/SPEC-v2-architecture.md` — v2 architecture overview
- `lib/db.ts` — Database schema init, migrations, v1→v2 repair logic
- `lib/auth.ts` — Registration, login, session validation
- `lib/with-auth.ts` — Auth middleware for API routes

---

*Last updated: 2026-07-14 — Base path downstream impact case study, desktop app settings fix, Telegram webhook re-registration, pointer-events drag-and-drop for mobile.*
