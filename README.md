# 🎙 conveneAI v2 — Distributed Meeting Intelligence Platform

One deployed server, three surfaces, all sharing the same user accounts:

1. **Web UI** (Next.js) — recordings history, per-meeting **chatbot** (RAG over the transcript), action items sidebar, diarized transcript, queue dashboard with live status, manual upload, model pickers, audio playback
2. **Telegram bot** — send an audio file, it's queued server-side, action items arrive when processing finishes ([t.me/conveneAI_bot](https://t.me/conveneAI_bot))
3. **macOS desktop app** (Tauri) — a *dumb recorder*: login → Record (mic or BlackHole internal audio) → Stop → upload. No local transcription. Option+R toggles recording globally.

Pipeline (all server-side, via a persistent job queue):
`audio → S3 → Deepgram (user-selected model, diarization) → LLM speaker names → LLM action items → SQLite → all surfaces`

## Architecture

- **Server** — Next.js 16 on a VPS. REST API + SSE queue updates + web UI + Telegram webhook + in-process job worker (started by `instrumentation.ts`, polls every 5s, survives restarts, retries failed jobs once).
- **Storage** — audio in **AWS S3** (`uploads/{userId}/{jobId}.mp3`, 90-day lifecycle policy, presigned URLs for playback); metadata in **SQLite** (`data/conveneai.db`, WAL mode).
- **Auth** — email + password (bcrypt, 12 rounds), httpOnly session cookie (`conveneai-auth`), 30-day sessions. All three surfaces log in against the same accounts.
- **BYOK** — users store their own Deepgram + Vercel AI Gateway keys (validated on save, AES-256-GCM encrypted, masked in the UI). Env keys act as server-wide fallbacks. LLM 429s fall back per `FALLBACK_MAP` in `lib/llm-client.ts`.
- **Batch processing** — recordings >30 min are split into 30-min chunks with ffmpeg, transcribed separately, merged with offset timestamps and name-based speaker normalization.

## Requirements

- Node.js 20+, **ffmpeg** (`brew install ffmpeg` / `apt install ffmpeg`) — needed for >30 min batch splitting and desktop MP3 encoding
- macOS + Rust toolchain (desktop app only): `xcode-select --install`, [rustup.rs](https://rustup.rs)
- Accounts/keys (each requires human sign-up):
  - **AWS** — IAM user with S3 read/write; one bucket ([console](https://aws.amazon.com/console), free tier 5GB/12mo)
  - **Deepgram** — [console.deepgram.com](https://console.deepgram.com) (free $200 credit)
  - **Vercel AI Gateway** — [vercel.com/ai-gateway](https://vercel.com/ai-gateway)
  - **Telegram bot token** — [@BotFather](https://t.me/BotFather) → `/newbot` (optional)

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` (see `.env.example` for the full list):

```bash
# Generate both with: openssl rand -hex 32
ENCRYPTION_KEY=<64 hex>                # AES-256-GCM for stored API keys
SESSION_SECRET=<64 hex>

AWS_ACCESS_KEY_ID=...                  # S3 audio storage
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=<your-bucket>

TELEGRAM_BOT_TOKEN=<optional>
DEEPGRAM_API_KEY=<optional fallback>
VERCEL_AI_GATEWAY_KEY=<optional fallback>
PUBLIC_BASE_URL=http://localhost:3000
```

### Create the S3 bucket (one-time)

```bash
aws s3api create-bucket --bucket <your-bucket> --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
aws s3api put-public-access-block --bucket <your-bucket> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-lifecycle-configuration --bucket <your-bucket> --lifecycle-configuration '{
  "Rules": [{ "ID": "delete-audio-after-90-days", "Status": "Enabled",
    "Filter": { "Prefix": "uploads/" }, "Expiration": { "Days": 90 },
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 } }] }'
```

## Run the web app

```bash
npm run dev        # http://localhost:3000
```

Register at `/register`, then: `/upload` (drag & drop), `/queue` (live status via SSE with polling fallback), `/settings` (API keys + model pickers + Telegram link), and click any recording for the chat-first detail view.

## Desktop app (macOS)

```bash
cd desktop && npm install && npm run tauri dev
```

Sign in with your web account (server URL configurable on the login screen — the session lives in memory, never on disk). Pick mic or BlackHole → Record → Stop → the file uploads and processing continues server-side; a native notification confirms the upload. **Option+R** toggles recording from anywhere using the last-used source. The window is decorated, draggable, always-on-top (toggleable), with a dock icon and a menu-bar tray icon (🎙 idle / 🔴 recording / ⚙ uploading).

Internal audio (Zoom calls etc.) requires [BlackHole](https://existential.audio/blackhole/): `brew install blackhole-2ch`. The app shows a setup guide if it's missing; microphone recording works without it.

## Telegram bot

Webhook mode — Telegram needs a public URL (tunnel in dev):

```bash
cloudflared tunnel --url http://localhost:3000    # or: ngrok http 3000

TOKEN="$(grep TELEGRAM_BOT_TOKEN .env | cut -d= -f2)"
SECRET="$(printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1)"
curl "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=https://<your-tunnel>/api/telegram/webhook" \
  -d "secret_token=${SECRET}"
```

Link your account: web UI → **Settings → Link Telegram** → send `/link CODE` to the bot. Linked users receive action items in Telegram for **every** recording (desktop, web, or Telegram-sourced). Unlinked senders fall back to the first account with a Deepgram key (single-user BYOK convenience).

## Tests

```bash
npm test                   # vitest — API routes, queue, pipeline (Deepgram/LLM/S3 mocked), auth, DB migration
npx playwright test        # browser E2E — register/login/upload/queue/settings/chat (uses real keys from .env, runs on :3100)
cd desktop && npx vitest run           # desktop React components
cd desktop/src-tauri && cargo test     # Rust: API client (wiremock), config, capture, encoder
```

## Deployment (Hetzner VPS)

1. **Provision** — CX22 (~€5/mo), Ubuntu 24.04. Install Node 20+ (NodeSource), then `apt install -y ffmpeg nginx certbot python3-certbot-nginx sqlite3`.
2. **App** — clone, `npm ci && npm run build`, create the production `.env` (never commit it).
3. **Process manager** — `npm i -g pm2 && pm2 start "npm start" --name conveneai && pm2 save && pm2 startup`.
4. **nginx** — reverse proxy with SSE support (buffering must be off for the queue stream):

   ```nginx
   server {
     server_name conveneai.example.com;
     client_max_body_size 500M;

     location /api/queue {
       proxy_pass http://localhost:3000;
       proxy_buffering off;              # required for SSE
       proxy_set_header Connection '';
       proxy_http_version 1.1;
       proxy_read_timeout 24h;
     }
     location / {
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```

5. **SSL** — `certbot --nginx -d conveneai.example.com`.
6. **S3** — create the bucket as above; put the IAM keys in `.env`.
7. **Telegram** — re-register the webhook with the production URL.
8. **DB backups** — daily cron, keep two weeks:

   ```cron
   0 3 * * * sqlite3 /srv/conveneai/data/conveneai.db ".backup /srv/backups/conveneai-$(date +\%Y\%m\%d).db" && find /srv/backups -name 'conveneai-*.db' -mtime +14 -delete
   ```

## Notes

- **v1 migration**: legacy session-scoped recordings are preserved in the DB with `user_id = NULL` (invisible to accounts, not destroyed). The old `/api/transcribe` inline endpoint is gone — everything goes through `POST /api/upload` + the queue.
- The job queue is single-worker by design (rate-limit friendly, SQLite-safe). Redis/BullMQ scaling is out of scope for the MVP.
- Spec: `specs/SPEC-v2-architecture.md` · PRD: [issue #10](https://github.com/ryanlim-producer/conveneAI/issues/10).
