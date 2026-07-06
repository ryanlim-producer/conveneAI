# AsisVoz v2 — Distributed Meeting Intelligence Platform

**Date:** 2026-07-06
**Status:** Draft
**Source:** derived from grilling session on 2026-07-06

## Overview

AsisVoz v2 splits the current monolith into three loosely-coupled surfaces connected by a single deployed server. Instead of the desktop app running transcription locally, it becomes a **dumb recorder** — capture audio, upload, done. The Telegram bot and web UI both run on the deployed server. All intelligence (transcription, diarization, action items, per-meeting chatbot) lives centrally on the server, with audio stored in AWS S3 and metadata in SQLite.

### Core principles

- **Server as single source of truth** — All recordings, transcriptions, action items, and chat history in one SQLite DB on the VPS, accessible from all three surfaces
- **Dumb edge clients** — Tauri records + uploads. Telegram receives + forwards. Neither transcribes.
- **BYOK with model selection** — User provides Deepgram + Vercel AI Gateway keys. The web UI lets them pick specific models from each provider, with recommended defaults.
- **Job queue with visibility** — Every recording goes through a queued pipeline with live status (queued → transcribing → processing → done/error), visible in the web UI
- **Chat-first recordings** — Clicking a recording opens a per-meeting chatbot (RAG over transcript) with action items in a sidebar and full transcript available via toggle/tab
- **User accounts** — Email + password authentication. Each user sees only their own recordings. Desktop app logs in with the same credentials.

## Architecture

```
┌──────────────────────────┐   ┌──────────────────────────┐
│   Tauri desktop app      │   │   Telegram bot           │
│   (macOS, Rust + React)  │   │   (on deployed server)   │
│                          │   │                          │
│  • Login (email + pw)   │   │  • Receives audio files  │
│  • Record button        │   │  • Links to user account │
│  • Source picker        │   │  • Pushes to job queue   │
│    (mic / BlackHole)    │   │                          │
│  • Timer + level bar    │   │                          │
│  • Stop → POST audio    │   │                          │
│  • Upload confirmation  │   │                          │
│  • Dock icon + tray     │   │                          │
│  • Option+R hotkey      │   │                          │
└──────────┬───────────────┘   └──────────┬───────────────┘
           │ POST /api/upload             │ internal call
           │ (multipart audio)            │
           ▼                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Deployed Server (Hetzner VPS)               │
   │                                                         │
   │  ┌───────────┐  ┌───────────┐  ┌────────┐  ┌────────┐ │
   │  │ REST API  │  │ Job Queue │  │ Web UI │  │ SQLite │ │
   │  │           │  │Worker     │  │(Next.js│  │  DB    │ │
   │  │ /upload   │  │           │  │ App)   │  │        │ │
   │  │ /queue    │  │ queued    │  │        │  │record- │ │
   │  │ /history  │  │ →transcri │  │ /      │  │ings    │ │
   │  │ /chat    │  │ →process  │  │ /recor │  │jobs    │ │
   │  │ /keys    │  │ →done/err │  │ ding/  │  │users   │ │
   │  │ /settings │  │           │  │ [id]   │  │keys    │ │
   │  └─────┬─────┘  └─────┬─────┘  │ /upload│  └────────┘ │
   │        │              │         │ /queue │              │
   │        ▼              ▼         │ /settin│              │
   │  ┌──────────────────────────┐   └────────┘              │
   │  │   Processing Pipeline    │                           │
   │  │  • Deepgram (ASR + diar) │                           │
   │  │  • LLM (action items)    │                           │
   │  │  • LLM (speaker names)   │                           │
   │  │  • LLM (chatbot RAG)     │                           │
   │  └────────────┬─────────────┘                           │
   └───────────────┼─────────────────────────────────────────┘
                   │
                   ▼
          ┌────────────────┐
          │    AWS S3      │
          │  (audio files) │
          └────────────────┘
```

### System Context

**What exists and is reused:**
- `lib/deepgram.ts` — `transcribeAudio()`, `getBalance()`, `TranscriptSegment` type
- `lib/llm-client.ts` — `callLLM()` with Vercel AI Gateway, 429 fallback
- `lib/action-extractor.ts` — `extractActionItems()` prompt + JSON parsing
- `lib/name-detector.ts` — `detectSpeakerNames()` prompt + JSON parsing
- `lib/crypto.ts` — `encrypt()` / `decrypt()` AES-256-GCM
- `lib/telegram-bot.ts` — `sendTelegramMessage()`, `sendChunkedText()`, `getBotToken()`, `getWebhookSecret()`
- `lib/telegram-audio.ts` — `downloadTelegramAudio()`
- `lib/telegram-reply.ts` — `formatTranscriptionReply()`
- `desktop/src-tauri/src/audio.rs` — device enumeration, BlackHole detection, RMS level
- `desktop/src-tauri/src/capture.rs` — cpal audio capture, WAV writing
- `desktop/src-tauri/src/recorder.rs` — state machine (Idle → Recording → Processing)
- `desktop/src-tauri/src/encoder.rs` — WAV → MP3 via ffmpeg
- `desktop/src-tauri/src/hotkey.rs` — global shortcut config
- `components/ui/*` — shadcn/ui primitives (badge, button, card, dialog, input, label, scroll-area, separator, skeleton, sonner)

**What is new:**
- User authentication (email + password) with bcrypt hashing + session tokens
- `POST /api/upload` — multipart audio upload endpoint (replaces `/api/transcribe` as the entry point)
- `GET /api/queue` — job queue status endpoint (SSE + REST)
- `GET /api/queue/:id` — individual job status
- `POST /api/queue/:id/retranscribe` — re-transcribe trigger
- `POST /api/chat/:recordingId` — per-meeting chatbot endpoint (RAG over transcript)
- `GET|PUT /api/settings` — user model preferences (Deepgram model, LLM model for action items, LLM model for chatbot)
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` — auth endpoints
- SQLite `users` table, `jobs` table, `chat_messages` table, `user_settings` table
- In-process job queue worker (picks up queued jobs, runs pipeline, updates status)
- S3 client (`lib/s3.ts`) for storing/retrieving audio files
- New page: `/upload` — manual audio upload
- New page: `/queue` — queue dashboard
- New page: `/settings` — model pickers
- New page: `/login`, `/register` — auth pages
- New component: `ChatWindow` — per-meeting chatbot UI
- New component: `QueueDashboard` — job queue list with status badges
- New component: `ModelPicker` — dropdown with recommended badge

**What is removed or replaced:**
- `POST /api/transcribe` — replaced by `POST /api/upload` + job queue
- `GET /api/balance` — Deepgram balance check becomes a settings page feature
- `app/recording/[id]/page.tsx` — restructured to chat-first layout
- `components/recording-detail.tsx` — replaced by `ChatWindow` + `ActionItemsSidebar` + `TranscriptPanel`
- `components/deepgram-balance.tsx` — removed (balance shown in settings)
- `components/api-key-gate.tsx` — replaced by auth middleware + settings page
- `components/key-setup-modal.tsx` — replaced by settings page
- `lib/session.ts` / `lib/with-session.ts` — replaced by auth session with user accounts
- `proxy.ts` — replaced by auth middleware
- Tauri: `src-tauri/src/api.rs` — rewritten from transcribe-upload to upload-only + auth
- Tauri: `src/App.tsx` — rewritten from popup views to persistent window with login + record
- Tauri: `src/components/RecorderUI.tsx` — kept and adapted for new window
- Tauri: `src/components/SourceSelector.tsx` — kept and adapted
- Tauri: `src/components/RecentList.tsx` — removed (not needed in dumb recorder)
- Tauri: `src/components/BlackHoleGuide.tsx` — kept
- Tauri: `tauri.conf.json` — window config changed from frameless popup to decorated window

## Requirements

### Functional

1. **User accounts**: Register, login, logout with email + password. Sessions persist via httpOnly cookie.
2. **API key management**: Users enter Deepgram + Vercel AI Gateway keys in settings. Keys are validated on save, encrypted at rest (AES-256-GCM, reused from existing `lib/crypto.ts`).
3. **Model selection**: Settings page shows Deepgram model picker (nova-3 recommended, nova-2, enhanced, base, whisper-cloud) + LLM model picker for action items + LLM model picker for chatbot. Each has a "Recommended" badge on the default.
4. **Audio upload (desktop)**: Tauri app POSTs multipart audio to `/api/upload` with session cookie. Returns 202 Accepted with `jobId`.
5. **Audio upload (Telegram)**: Telegram bot downloads audio, calls internal upload pipeline, returns job status message to user.
6. **Manual upload (web)**: Upload page in web UI — drag-and-drop or file picker for audio files, queued for processing.
7. **Job queue**: Every upload creates a job record with status `queued`. An in-process worker picks up jobs sequentially, updates status to `transcribing` → `processing_action_items` → `done` or `error`. Status visible in queue dashboard.
8. **Transcription pipeline (unchanged logic)**: Deepgram (chosen model + language) → speaker name detection (LLM) → action item extraction (LLM). Stored in recordings table.
9. **Re-transcribe**: Button on a recording triggers full re-processing (re-runs transcription + name detection + action items). Creates a new job.
10. **Batch processing**: Long recordings (>30 min) are auto-split into chunks, each chunk transcribed separately, results merged with deduplication of speaker IDs.
11. **Recording detail page**: Chat-first layout. Chat window occupies main area (RAG over transcript). Action items in collapsible sidebar. Full transcript accessible via "Transcript" tab/toggle.
12. **Per-meeting chatbot**: User types questions about the meeting. System prompt includes the full transcript + speaker map + action items as context. LLM answers are scoped to that recording only.
13. **Recording history**: List of all recordings with metadata (filename, source icon, duration, speaker count, action item count, job status). Click to open detail view. Delete button.
14. **Queue dashboard**: Live view of all jobs with status badges (queued/pending, transcribing/spinner, processing action items, done/checkmark, error/red). SSE for real-time updates.
15. **Telegram integration**: Bot runs on same server. Receives audio → queues job → notifies user when done. Linked users receive action items for desktop recordings. `/link CODE` flow remains unchanged.
16. **Tauri desktop app**: Real decorated macOS window (draggable, minimizable, closable) with dock icon + menu bar tray icon. Always-on-top toggle. Login screen on first launch. Record button → source picker (mic/BlackHole) → timer + level bar + Stop button → upload → confirmation → reset. Option+R hotkey toggles recording immediately with last-used source.
17. **Copy transcript**: Button on detail page copies full diarized transcript to clipboard.
18. **Delete recording**: Deletes DB record + S3 audio file + chat messages.

### Non-Functional

1. **Security**: Passwords hashed with bcrypt (12 rounds). API keys encrypted at rest (AES-256-GCM, existing). All audio uploads scoped to authenticated user. S3 bucket policy restricts access to server IAM role.
2. **Reliability**: Job queue persists in SQLite — survives server restarts. Failed jobs retry once before marking `error`.
3. **Performance**: Deepgram batch mode for files, streaming not required. Chatbot responses within ~3s (standard LLM latency). Queue worker processes one job at a time to avoid rate limiting.
4. **Observability**: All pipeline steps log to stdout. Job status transitions are timestamped in the jobs table. Error messages are human-readable and shown in the UI.
5. **Storage**: S3 bucket with lifecycle policy — delete source audio after 90 days. SQLite DB backed up daily via cron + `sqlite3 .backup`.

## Implementation Plan

### Database Schema Changes

#### New Tables

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recording_id TEXT REFERENCES recordings(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','transcribing','processing_action_items','done','error')),
  source TEXT NOT NULL CHECK(source IN ('desktop','telegram','web_upload')),
  s3_key TEXT,
  filename TEXT NOT NULL,
  error_message TEXT,
  model_used TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  deepgram_model TEXT NOT NULL DEFAULT 'nova-3',
  actions_llm_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-r1',
  chatbot_llm_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-r1',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_user ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_chat_messages_recording ON chat_messages(recording_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_sessions_token ON user_sessions(token);
```

#### Modified Table

```sql
-- recordings table adds:
-- user_id column (was session_id)
-- s3_key column (replaces mp3_path)
-- job_id column (links to jobs table)
ALTER TABLE recordings ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE recordings ADD COLUMN s3_key TEXT;
ALTER TABLE recordings ADD COLUMN job_id TEXT REFERENCES jobs(id);
```

### Files to Create

| File | Purpose |
|------|---------|
| `lib/s3.ts` | AWS S3 client — upload, download, presigned URL, delete |
| `lib/auth.ts` | User registration, login, logout, session middleware |
| `lib/queue.ts` | SQLite-backed job queue with in-process worker |
| `lib/pipeline.ts` | Transcription pipeline orchestrator (Deepgram → names → actions → S3) |
| `lib/chatbot.ts` | Per-meeting RAG chatbot (system prompt builder + LLM call) |
| `app/api/auth/register/route.ts` | POST — email + password → user + session |
| `app/api/auth/login/route.ts` | POST — email + password → session |
| `app/api/auth/logout/route.ts` | POST — clear session |
| `app/api/upload/route.ts` | POST — multipart audio → S3 → enqueue job |
| `app/api/queue/route.ts` | GET — list all jobs for user (REST + SSE) |
| `app/api/queue/[id]/route.ts` | GET — single job status |
| `app/api/queue/[id]/retranscribe/route.ts` | POST — queue retranscription of a completed/failed job |
| `app/api/history/[id]/audio/route.ts` | GET — presigned S3 URL for audio playback |
| `app/api/chat/[recordingId]/route.ts` | GET — chat history; POST — user message → chatbot response |
| `app/api/settings/route.ts` | GET/PUT — user model preferences |
| `app/login/page.tsx` | Login page |
| `app/register/page.tsx` | Registration page |
| `app/upload/page.tsx` | Manual audio upload page |
| `app/queue/page.tsx` | Queue dashboard |
| `app/settings/page.tsx` | Settings page (API keys + model pickers) |
| `components/chat-window.tsx` | Chat interface for per-meeting chatbot |
| `components/action-items-sidebar.tsx` | Collapsible action items panel |
| `components/transcript-panel.tsx` | Toggle/tab view of full diarized transcript |
| `components/queue-dashboard.tsx` | Job list with status badges + SSE live updates |
| `components/model-picker.tsx` | Dropdown with "Recommended" badge |
| `components/user-nav.tsx` | User avatar/dropdown in header (settings, logout) |
| `components/upload-zone.tsx` | Drag-and-drop file upload area |
| `lib/sse.ts` | SSE helper for streaming queue updates + nginx config notes |
| `lib/models.ts` | Model constants (Deepgram + LLM model lists with recommended flags) |
| `instrumentation.ts` | Next.js lifecycle hook — starts queue worker on server boot |
| `middleware.ts` | Auth middleware — redirects unauthenticated users to /login |
| `desktop/src/Login.tsx` | Tauri login screen component |
| `desktop/src/components/UploadProgress.tsx` | Upload progress + confirmation UI |
| `desktop/src-tauri/src/auth.rs` | Auth token storage (keychain or config file) |

### Files to Modify

| File | Change |
|------|--------|
| `lib/db.ts` | Add new table schemas, add `user_id` to recordings, replace `session_id` |
| `lib/deepgram.ts` | Add `model` parameter to `transcribeAudio()` (currently hardcoded `nova-2`). Add model enum/constants |
| `lib/llm-client.ts` | Already generic — no changes needed beyond model being passed dynamically |
| `lib/action-extractor.ts` | Accept `model` parameter, pass to `callLLM()` |
| `lib/name-detector.ts` | Accept `model` parameter, pass to `callLLM()` |
| `lib/telegram-bot.ts` | Update `notifyLinkedTelegram()` to use `user_id` instead of `session_id`. Replace `handleAudioMessage` inline logic with call to `enqueueJob()` |
| `app/api/telegram/webhook/route.ts` | Replace inline transcription with job queue enqueue. Resolve `user_id` instead of `session_id` |
| `app/api/history/route.ts` | Scope by `user_id` instead of `session_id` |
| `app/api/history/[id]/route.ts` | Scope by `user_id` instead of `session_id` |
| `app/api/keys/route.ts` | Scope by `user_id` instead of `session_id` |
| `app/page.tsx` | Add auth gate, user nav. Keep `HistoryList` but update data shape |
| `app/layout.tsx` | Add `UserNav`, auth-aware layout, theme provider |
| `app/globals.css` | Add chat message styles, queue status animation |
| `lib/session.ts` | Replace iron-session anonymous sessions with authenticated sessions |
| `lib/with-session.ts` | Replace with auth middleware that checks user session token |
| `desktop/src/App.tsx` | Rewrite: login gate → record button → source picker → recorder → upload |
| `desktop/src/RecorderUI.tsx` | Adapt for windowed layout (larger, decorated) |
| `desktop/src-tauri/src/lib.rs` | Replace `cmd_start_recording`/`cmd_stop_recording` with upload-only flow. Add login/register commands. Remove tray popup logic, replace with window show/hide. Change `set_activation_policy` to `Regular` (show dock icon) |
| `desktop/src-tauri/tauri.conf.json` | Change window: `decorations: true`, `transparent: false`, `alwaysOnTop: true` (configurable), `skipTaskbar: false`, `width: 400`, `height: 500`, `resizable: true`, `visible: true`. Add second window config for login/record flow |
| `desktop/src-tauri/src/api.rs` | Replace `upload_audio()` (which calls `/api/transcribe`) with `upload_audio()` (calls `/api/upload`). Add `login()`, `register()`, `getQueueStatus()` |
| `desktop/src-tauri/src/config.rs` | Add `auth_token` field for session persistence |

### Files to Delete

| File | Reason |
|------|--------|
| `components/api-key-gate.tsx` | Replaced by auth middleware + settings page |
| `components/deepgram-balance.tsx` | Balance moved to settings page |
| `components/key-setup-modal.tsx` | Replaced by settings page |
| `components/telegram-link.tsx` | Telegram link code flow redesign (TBD inline in settings) |
| `app/api/balance/route.ts` | Balance check moved to settings |
| `app/api/balance/route.test.ts` | — |
| `desktop/src/components/RecentList.tsx` | Not needed in dumb recorder |
| `desktop/src/components/RecentList.test.tsx` | — |

### Step-by-Step Implementation

#### Phase 1: Auth & Server Foundation

1. **Add user auth schema** — Create `users`, `user_sessions` tables in `lib/db.ts`. Add `lib/auth.ts` with bcrypt hashing, session token generation, and middleware.

2. **Build auth API routes** — `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`. Return httpOnly session cookie. Write tests.

3. **Auth middleware** — Replace `lib/with-session.ts` with auth middleware that validates session tokens. Apply to all protected routes. Unauthenticated requests redirect to `/login`.

4. **Login + Register pages** — Create `app/login/page.tsx` and `app/register/page.tsx` with email + password forms, validation, error states, and redirect.

#### Phase 2: S3 + Upload Pipeline

5. **S3 client** — Create `lib/s3.ts`. Configure AWS SDK v3 with credentials from env vars. Functions: `uploadAudio(buffer, key)`, `getPresignedUrl(key, expiresIn)`, `deleteAudio(key)`, `getAudioStream(key)`.

6. **Create `POST /api/upload`** — Authenticated endpoint. Accept multipart audio file. Validate file type (reuse audio type list from existing `/api/transcribe`). Upload to S3 (`uploads/{userId}/{jobId}.mp3`). Insert job row with status `queued`. Return 202 with `{ jobId }`.

7. **Job queue schema + worker** — Create `lib/queue.ts`. `CREATE TABLE jobs` as above. `enqueueJob(userId, filename, s3Key, source, language)` → inserts row. `processNextJob()` → picks oldest queued job, runs pipeline, updates status. Worker started in `instrumentation.ts` (Next.js 16 lifecycle hook, fires once on server boot). Polls for queued jobs every 5s. Only one job processes at a time (mutex via `activeJob` flag). Worker gracefully stops on SIGTERM. Chain-trigger: after each job completes, immediately check for the next queued job (no 5s wait). Fallback: if `instrumentation.ts` is unreliable in dev HMR, embed a one-shot `processOneJob()` call inside the upload handler itself, with each completed job triggering the next.

8. **Update existing API key routes** — Modify `app/api/keys/route.ts` to scope by `user_id` instead of `session_id`.

#### Phase 3: Processing Pipeline

9. **Pipeline orchestrator** — Create `lib/pipeline.ts`. Function `processJob(job)`: fetch audio from S3 → call Deepgram (with user's chosen model from settings) → detect speaker names → extract action items → insert into recordings table → update job status to `done`. On error: update job status to `error` with error message. Read user's model preferences from `user_settings` table.

10. **Parameterize Deepgram model** — Modify `lib/deepgram.ts`: `transcribeAudio()` accepts `model` parameter (default `nova-3`). Hardcoded `nova-2` replaced. Model options: `nova-3`, `nova-2`, `nova-2-meeting`, `enhanced`, `base`, `whisper-medium`.

11. **Parameterize LLM calls** — Modify `lib/action-extractor.ts` and `lib/name-detector.ts` to accept `model` parameter. Pass through to `callLLM()`.

12. **Re-transcribe endpoint** — `POST /api/queue/[id]/retranscribe`: validates job belongs to user, creates a NEW job entry pointing to same S3 audio, creates a NEW recording (does not overwrite original), enqueues. Original job + recording + chat messages preserved.

13. **Batch processing** — In `lib/pipeline.ts`: if audio duration > 30 min (detected via ffprobe metadata before transcription), split audio file into 30-min chunks using ffmpeg (`ffmpeg -i input.mp3 -f segment -segment_time 1800 -c copy chunk_%03d.mp3`). Transcribe each chunk separately via Deepgram. Merge segments with offset-adjusted timestamps. Normalize speaker IDs by running name detection on the combined transcript of all chunks, then re-assigning consistent speaker numbers based on detected names (e.g., "María" → Speaker 1 in all chunks). If name detection fails, offset chunk-local IDs (chunk N Speaker 0 → global Speaker N*10) to prevent accidental cross-chunk speaker merging.

14. **Update Telegram webhook** — Replace inline transcription in `handleAudioMessage` with: download audio → upload to S3 → enqueue job → send "Processing..." message with job ID. Add callback to notify Telegram user when job completes (or user checks `/status`).

#### Phase 4: Web UI — Chat + Queue

15. **Per-meeting chatbot API** — `POST /api/chat/[recordingId]`: accepts `{ message }`, returns `{ reply }`. Builds system prompt with full transcript + speaker map + action items as context. Calls LLM via `callLLM()` using user's chatbot model preference. Saves user + assistant messages to `chat_messages`. Returns assistant reply.

16. **ChatWindow component** — `components/chat-window.tsx`: Scrollable message list + text input + send button. Loading state while waiting for LLM response. Error state for failed messages. Empty state ("Ask a question about this meeting").

17. **ActionItemsSidebar component** — `components/action-items-sidebar.tsx`: Collapsible panel listing action items with assignee badges, deadline, and context. Empty state if no action items.

18. **TranscriptPanel component** — `components/transcript-panel.tsx`: Toggle/tab panel showing the full diarized transcript with speaker-colored labels and timestamps. Copy button.

19. **Rebuild recording detail page** — `app/recording/[id]/page.tsx`: Chat-first layout. Main area = `ChatWindow`. Right sidebar = `ActionItemsSidebar`. Tab/toggle at top = `TranscriptPanel`. Back button to recordings list.

20. **QueueDashboard component** — `components/queue-dashboard.tsx`: Table/list of jobs for current user. Columns: filename, source icon, status badge (with color + icon), created time, duration. SSE connection for live updates. Error jobs show error message inline. Retry button for errored jobs.

21. **Queue page** — `app/queue/page.tsx`: Header + `QueueDashboard`. SSE endpoint at `GET /api/queue?stream=true`.

22. **Upload page** — `app/upload/page.tsx`: Drag-and-drop zone + file picker. Validates audio file types. Progress bar during upload. Redirects to queue on success. Error state for invalid files or upload failures.

23. **Settings page** — `app/settings/page.tsx`: Sections: (a) API Keys — Deepgram + Vercel AI Gateway, with masked display + validate + save, (b) Model Selection — three `ModelPicker` components with recommended badges, (c) Account — email display, logout button.

24. **ModelPicker component** — `components/model-picker.tsx`: Dropdown select with options. First option shows "⭐ Recommended". Displays model name + brief description. Values come from constants in `lib/models.ts`.

25. **Update recordings list page** — `app/page.tsx`: Replace `HistoryList` with auth-gated version scoped by `user_id`. Add link to upload page and queue dashboard. Add `UserNav` in header.

26. **SSE helper** — `lib/sse.ts`: Utility for server-sent events. Creates `ReadableStream` with `text/event-stream` content type. `QueueDashboard` attempts SSE first, falls back to polling (5s interval via `GET /api/queue` REST mode) if SSE connection fails or times out. Document nginx config: `proxy_buffering off;` required for `/api/queue` location.

#### Phase 5: Tauri Desktop App Rewrite

27. **Tauri window config** — Update `tauri.conf.json`: Set `decorations: true`, `transparent: false`, `alwaysOnTop: true`, `skipTaskbar: false`, `width: 400`, `height: 500`, `resizable: true`, `center: true`. Add `app.withGlobalTauri: true`. Change `activationPolicy` to `Regular` for dock icon. Keep tray icon alongside dock.

28. **Tauri login** — New `desktop/src/Login.tsx`: Email + password form. Calls `POST /api/auth/login`. Stores session cookie in reqwest cookie jar (already supported by `ApiClient`). On success, transitions to main view. Saves API URL from login server for subsequent requests.

29. **Rewrite App.tsx** — Three states: (a) Not authenticated → show `Login`, (b) Idle → show Record button + source picker, (c) Recording → show `RecorderUI` (timer + level bar + Stop). Auth state persisted via cookie jar. Session validated on app launch via `GET /api/queue` (cheap auth check).

30. **Record flow** — Record button → if internal audio selected, check BlackHole availability (show guide if missing). If source is blackhole, use existing `capture::start_capture("blackhole")`. If source is mic, use `capture::start_capture("mic")`. Timer + level bar poll via existing IPC commands. Stop → encode MP3 (existing `encoder.rs`) → `POST /api/upload` (multipart form with session cookie) → show confirmation toast → reset to Record button.

31. **Update Rust commands** — Modify `cmd_start_recording`: same capture logic, no transcription. Modify `cmd_stop_recording`: stop capture → encode MP3 → upload to `/api/upload` with auth token → notification with result → reset state. Add `cmd_login(email, password, apiUrl)` command. Add `cmd_get_auth_status()` command.

32. **Hotkey** — Option+R: if idle → start recording with last-used source. If recording → stop. No popup navigation needed since the window is always visible. Reuse existing `hotkey.rs` and global shortcut plugin.

33. **Tray menu** — Keep Start Recording, Settings, Quit. Add "Show Window" item. On menu click: show and focus the main window.

#### Phase 6: Polish & Deploy

34. **Environment config** — `env.example` updated with new vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `SESSION_SECRET` (unchanged), `ENCRYPTION_KEY` (unchanged), `TELEGRAM_BOT_TOKEN` (unchanged), `VERCEL_AI_GATEWAY_KEY` (unchanged), `DEEPGRAM_API_KEY` (unchanged — still server fallback), `PUBLIC_BASE_URL` (unchanged).

35. **S3 lifecycle policy** — Document (or Terraform/script) for setting up S3 bucket with lifecycle rule: delete objects after 90 days.

36. **DB backup cron** — Document (or script) for daily SQLite backup via `sqlite3 /data/asisvoz.db ".backup /backups/asisvoz-$(date +%Y%m%d).db"`.

37. **Deployment guide** — Update README with Hetzner VPS setup steps: Node.js 20+, ffmpeg (`apt install ffmpeg`), nginx reverse proxy (with `proxy_buffering off` for `/api/queue` SSE), Let's Encrypt SSL, PM2 process manager, env var setup, S3 bucket creation, Telegram webhook registration.

## Dependencies

### New npm packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@aws-sdk/client-s3` | ^3.x | AWS S3 client |
| `@aws-sdk/s3-request-presigner` | ^3.x | Presigned URL generation |
| `bcrypt` | ^5.x | Password hashing |
| `bcryptjs` | ^2.x | Fallback if bcrypt native compilation fails |

### New environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AWS_ACCESS_KEY_ID` | Yes | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | S3 secret key |
| `AWS_REGION` | Yes | S3 bucket region (e.g., `us-east-1`) |
| `AWS_S3_BUCKET` | Yes | S3 bucket name |

### External service accounts

| Service | What's needed | Link |
|---------|--------------|------|
| AWS | IAM user with S3 read/write on one bucket. Free tier: 5GB for 12 months. | https://aws.amazon.com/console |
| Deepgram | API key with $200 free credit. | https://console.deepgram.com |
| Vercel AI Gateway | API key. | https://vercel.com/ai-gateway |
| Telegram | Bot token from @BotFather. | https://t.me/BotFather |
| Hetzner | VPS (CX22, ~€5/mo). | https://hetzner.com/cloud |

## API Design

### Auth

#### `POST /api/auth/register`
- **Purpose:** Create a new user account
- **Request:** `{ email: string, password: string }`
- **Response 201:** `{ userId: string }` + set session cookie
- **Errors:** 400 (invalid email/password), 409 (email already exists)

#### `POST /api/auth/login`
- **Purpose:** Authenticate and create session
- **Request:** `{ email: string, password: string }`
- **Response 200:** `{ userId: string }` + set session cookie
- **Errors:** 401 (invalid credentials), 400 (missing fields)

#### `POST /api/auth/logout`
- **Purpose:** Clear session
- **Response 200:** `{ ok: true }`

### Upload & Queue

#### `POST /api/upload`
- **Purpose:** Upload audio file for processing
- **Auth:** Required (session cookie)
- **Request:** `multipart/form-data` with `file` field (audio/mpeg, audio/wav, audio/webm, audio/ogg, audio/mp4, audio/x-m4a) and optional `language` field (default `"es"`)
- **Response 202:** `{ jobId: string, status: "queued" }`
- **Errors:** 400 (no file or invalid type), 401 (not authenticated), 413 (file too large)

#### `GET /api/queue`
- **Purpose:** List all jobs for the authenticated user
- **Auth:** Required
- **Query:** `?stream=true` for SSE mode
- **Response 200:** `{ jobs: Job[] }`
- **SSE events:** `data: { type: "update", job: Job }`

#### `GET /api/queue/[id]`
- **Purpose:** Get single job status
- **Auth:** Required
- **Response 200:** `{ job: Job }`
- **Errors:** 404

#### `POST /api/queue/[id]/retranscribe`
- **Purpose:** Re-process a completed/failed recording. Creates a new job + new recording row, preserving the original.
- **Auth:** Required
- **Response 202:** `{ jobId: string, status: "queued" }`
- **Errors:** 404 (original job not found), 409 (original job is still processing)

### Chat

#### `POST /api/chat/[recordingId]`
- **Purpose:** Send a message to the per-meeting chatbot
- **Auth:** Required
- **Request:** `{ message: string }`
- **Response 200:** `{ reply: string, messageId: string }`
- **Errors:** 404 (recording not found), 500 (LLM error)

#### `GET /api/chat/[recordingId]`
- **Purpose:** Get chat history for a recording
- **Auth:** Required
- **Response 200:** `{ messages: ChatMessage[] }`

### Settings

#### `GET /api/settings`
- **Purpose:** Get user's model preferences
- **Auth:** Required
- **Response 200:** `{ deepgramModel: string, actionsLlmModel: string, chatbotLlmModel: string }`

#### `PUT /api/settings`
- **Purpose:** Update user's model preferences
- **Auth:** Required
- **Request:** `{ deepgramModel?: string, actionsLlmModel?: string, chatbotLlmModel?: string }`
- **Response 200:** `{ updated: true }`
- **Errors:** 400 (invalid model name)

### Keys (Modified)

#### `GET /api/keys`
- **Purpose:** Get masked API key status for current user
- **Auth:** Required
- **Response 200:** `{ keys: { deepgram?: string, "vercel-ai-gateway"?: string } }`

#### `POST /api/keys`
- **Purpose:** Save API key (validated, encrypted)
- **Auth:** Required
- **Request:** `{ provider: "deepgram" | "vercel-ai-gateway", key: string }`
- **Response 200:** `{ success: true }`
- **Errors:** 400 (invalid key or provider)

### History (Modified)

#### `GET /api/history`
- **Purpose:** List recordings for authenticated user
- **Auth:** Required
- **Response 200:** `{ recordings: HistoryRecording[], total: number }`

#### `GET /api/history/[id]`
- **Purpose:** Get recording detail (transcript, speakers, action items)
- **Auth:** Required
- **Response 200:** `{ id, filename, source, durationSeconds, speakerCount, fullTranscript, segments, speakers, actionItems, jobStatus, createdAt }`
- **Errors:** 404

#### `DELETE /api/history/[id]`
- **Purpose:** Delete recording + S3 audio + chat messages
- **Auth:** Required
- **Response 200:** `{ deleted: true, id }`
- **Errors:** 404

#### `GET /api/history/[id]/audio`
- **Purpose:** Get presigned S3 URL for audio playback
- **Auth:** Required
- **Response 200:** `{ url: string, expiresIn: 3600 }`
- **Errors:** 404 (recording not found or no S3 key)

## Data Model

### TypeScript Types (shared)

```typescript
interface Job {
  id: string;
  userId: string;
  recordingId: string | null;
  status: "queued" | "transcribing" | "processing_action_items" | "done" | "error";
  source: "desktop" | "telegram" | "web_upload";
  s3Key: string | null;
  filename: string;
  errorMessage: string | null;
  modelUsed: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface ChatMessage {
  id: string;
  recordingId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface UserSettings {
  deepgramModel: string;
  actionsLlmModel: string;
  chatbotLlmModel: string;
}

interface User {
  id: string;
  email: string;
  createdAt: string;
}
```

### Model Constants

```typescript
// lib/models.ts
export const DEEPGRAM_MODELS = [
  { value: "nova-3", label: "Nova-3", description: "Latest, best accuracy, multi-speaker meetings", recommended: true },
  { value: "nova-2", label: "Nova-2", description: "Filler word detection, broader niche languages" },
  { value: "nova-2-meeting", label: "Nova-2 Meeting", description: "Optimized for meeting transcription" },
  { value: "enhanced", label: "Enhanced", description: "Lower WER than Base, keyword boosting" },
  { value: "base", label: "Base", description: "High volume, good timestamps" },
  { value: "whisper-medium", label: "Whisper Cloud (Medium)", description: "OpenAI Whisper, rate-limited" },
] as const;

export const LLM_MODELS = [
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1", description: "Reasoning model, best for structured extraction", recommended: true },
  { value: "openai/gpt-4o", label: "GPT-4o", description: "Fast, good for chat" },
  { value: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", description: "Balanced, good for chat and extraction" },
  { value: "openai/gpt-4.1", label: "GPT-4.1", description: "Latest, strong reasoning" },
] as const;
```

## Testing Strategy

### Unit Tests (Vitest)

1. **Auth**: Registration, login, logout, password hashing, session validation, duplicate email rejection
2. **Job Queue**: Enqueue, dequeue, status transitions, concurrent access, error handling, retry logic
3. **S3 Client**: Upload, download, presigned URL, delete, error handling for missing objects
4. **Pipeline**: End-to-end with mocked Deepgram + LLM, error at each stage, batch splitting logic
5. **Chatbot**: System prompt construction, context window limits, message history truncation
6. **Model picker validation**: Reject invalid model names, default fallback
7. **Existing tests**: All existing `lib/*.test.ts` and route tests adapted for new auth model

### Browser Tests (Playwright — future)

1. Full user flow: register → login → upload audio → see queue → wait for processing → open recording → chat → check action items
2. Queue SSE updates visible in real-time
3. Re-transcribe flow
4. Settings page: add keys, change models
5. Mobile responsive layout

### Manual Verification

1. Deploy to Hetzner VPS, configure env vars, verify all endpoints
2. Send audio via Telegram bot, verify job appears in queue, verify notification
3. Record from Tauri app with mic, verify upload, verify job, verify result in web UI
4. Record from Tauri app with BlackHole (internal audio), verify same flow
5. Test batch processing with >30 min audio file
6. Test re-transcribe on a completed recording
7. Test error cases: invalid API key, network failure during processing, oversized file

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite concurrent write contention | High — corrupted DB | Single in-process worker, WAL mode, busy timeout. Daily backups |
| S3 upload failures from Tauri | Medium — lost recording | Retry with exponential backoff, show error to user immediately |
| Vercel AI Gateway rate limits | Medium — stuck jobs | Existing 429 fallback in `llm-client.ts`. Queue worker respects rate limits |
| Deepgram rate limits | Medium — stuck jobs | Queue worker serializes jobs. Retry once with backoff |
| Large audio files (>500MB) | Low — S3 costs + timeout | File size limit at upload (configurable, default 500MB). Batch splitting for long recordings |
| BlackHole not installed | Low — can't record internal audio | `BlackHoleGuide` component shows install instructions. Mic still works |
| ffmpeg not installed on VPS | Medium — can't batch split | Check in deploy script. Install via apt: `apt install ffmpeg` |

## Design Decisions & Trade-offs

1. **Chatbot context window**: The full transcript + speaker map + action items + conversation history must fit in the LLM's context window. For very long meetings, transcript truncation or summarization may be needed. **Decision:** Truncate transcript to last 20K tokens if it exceeds the model's limit, with a note to the user.

2. **Multi-user concurrency**: Single in-process worker means only one job processes at a time. For multiple active users, jobs queue up. Is this acceptable? **Decision:** Yes for MVP — single-user target audience. Can add Redis + BullMQ later if needed.

3. **S3 bucket region**: Which AWS region? **Decision:** `us-east-1` unless the user specifies otherwise. Bucket creation is a manual step before deploy.

4. **Tauri app code signing**: For the desktop app to be distributable without Gatekeeper warnings, it needs an Apple Developer account ($99/year). **Decision:** Not required for personal use — users can right-click → Open to bypass.

5. **Tauri auth token storage**: Session tokens (httpOnly cookies) are managed automatically by reqwest's cookie jar — they live in memory, not on disk. For persistent login across app restarts, the Tauri app stores the **API URL** in `config.rs` (as today), but the session token is obtained fresh on each launch via `POST /api/auth/login`. No auth tokens are written to the plaintext settings JSON file. If the user checks "Remember me", the password is stored in the macOS Keychain (via `security` CLI or the `keyring` crate) — never in the config file.

6. **Telegram user linking**: The `/link CODE` flow is redesigned for user accounts:
   - The web UI generates a one-time code scoped to the authenticated user (stored in `link_codes` with `user_id`, not `session_id`)
   - Telegram user sends `/link CODE` → bot stores `telegram_links` row with `user_id` from the code
   - Unlinked Telegram users still fall back to the first user with a Deepgram key configured (for the BYOK single-user case)
   - The `telegram_links` table gains a `user_id` column (replaces `session_id`)

7. **Worker lifecycle in Next.js**: The in-process queue worker MUST be started in `instrumentation.ts` (Next.js 16's supported lifecycle hook), not in a route handler or `setInterval` at module scope. This ensures the worker:
   - Starts exactly once when the server boots (not once per route hit)
   - Survives across HMR reloads in development
   - Has access to the database connection
   - Alternative if `instrumentation.ts` proves unreliable: a one-shot `processAllPendingJobs()` call embedded in the upload handler, with each job triggering the next in a chain

8. **Batch speaker normalization algorithm**: When splitting recordings into chunks, speaker IDs are chunk-local (Deepgram assigns Speaker 0, 1, etc. independently per chunk). Merging:
   - Transcribe all chunks first, collecting their segments
   - Run speaker name detection on the combined transcript (not per-chunk)
   - Re-assign consistent speaker numbers based on detected names (e.g., all segments attributed to "María" get speaker 0, "Carlos" gets speaker 1)
   - Fallback: if name detection fails, keep chunk-local speaker IDs but offset them (chunk N's Speaker 0 → global Speaker N*10, preventing accidental merging of different speakers)

9. **Re-transcribe behavior**: `POST /api/queue/[id]/retranscribe` creates a NEW job pointing to the same S3 audio key, but produces a NEW recording row (not overwriting the original). The original recording + chat messages are preserved. The new recording appears alongside the old one in the history list, differentiated by `created_at`. Old recording can be deleted independently.

10. **Audio playback**: Recordings page and detail view need an audio player. Use S3 presigned URLs (1 hour expiry) generated via `GET /api/history/[id]/audio` which returns `{ url: string }`. The web UI renders an `<audio>` element with the presigned URL. No direct S3 access from the browser.

11. **Language selection**: The upload flow preserves the `language` parameter. Users select language per-recording (default `es` for Spanish). The upload endpoint accepts `language` as a form field alongside the audio file. The pipeline passes it to Deepgram. Web upload page includes a language dropdown. Tauri app includes language in the upload form.

12. **SSE implementation**: `GET /api/queue?stream=true` uses Next.js `ReadableStream` with `text/event-stream` content type. The stream sends `data:` lines for each job status change. Fallback: if SSE fails (e.g., proxy buffering in nginx), the dashboard falls back to polling at 5s intervals via `GET /api/queue` (REST mode). nginx config must include `proxy_buffering off;` for the `/api/queue` location block.
