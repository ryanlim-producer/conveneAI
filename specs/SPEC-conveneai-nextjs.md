# conveneAI — Transcription + Action Items Platform

**Date:** 2026-06-29
**Status:** Final
**Source:** derived from [conveneAI desktop app](https://github.com/revkelo/conveneAI), UI inspired by [OpenSuperWhisper](https://github.com/starmel/OpenSuperWhisper), and extended grilling session on 2026-06-25/29

## Overview

A meeting transcription platform with **two input channels** (desktop hotkey recording + Telegram bot) and **AI-powered action item extraction**. Audio is transcribed via Deepgram with speaker diarization and name detection, then an LLM extracts action items which are delivered to Telegram. A web UI provides full history, transcript viewing, and copy-to-clipboard.

The system consists of:
- **Next.js 16 server** — API, Telegram webhook, web UI, SQLite persistence
- **Tauri v2 desktop app** — Global hotkey, audio capture (internal + mic via BlackHole), cursor popup menu
- **Telegram bot** — Audio input channel, action item delivery

Everything syncs through a single SQLite database. Designed for localhost development → Hetzner VPS deployment.

### Core principles

- **Single source of truth** — All recordings, transcriptions, and action items in one SQLite DB, accessible from all three surfaces
- **BYOK** — User provides their own Deepgram and OpenRouter API keys, encrypted at rest
- **Menu bar utility** — Desktop app is a background utility (menu bar icon, global hotkey), not a dock app
- **Two-step recording** — Hotkey → select source (internal/external audio) → recording starts
- **Fire-and-forget bot** — Send audio to Telegram bot → get action items + copy button back

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Next.js Server (localhost:3000)            │
│                                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌───────────┐ │
│  │ REST API │  │ Telegram   │  │ Web UI   │  │ SQLite    │ │
│  │          │  │ Webhook    │  │ (Next.js)│  │ DB        │ │
│  │ /transcribe│ │ /api/tg/  │  │ /        │  │           │ │
│  │ /history │  │ webhook    │  │ /history │  │ recordings│ │
│  │ /actions │  │            │  │ /actions │  │ transcript│ │
│  │ /keys    │  │            │  │          │  │ actions   │ │
│  └────┬─────┘  └─────┬──────┘  └────┬─────┘  └─────┬─────┘ │
│       │              │              │               │       │
└───────┼──────────────┼──────────────┼───────────────┼───────┘
        │              │              │               │
        ▼              ▼              ▼               │
┌─────────────┐ ┌──────────┐ ┌──────────┐            │
│ Tauri       │ │ Telegram │ │ Browser  │            │
│ Desktop App │ │ Client   │ │          │            │
│             │ │          │ │ Web UI   │            │
│ 🎙 menu bar│ │ send audio│ │ history  │            │
│ ⌨ hotkey   │ │ get items│ │ actions  │            │
│ 🎧 BlackHole│ │ copy text│ │ settings │            │
│ 🎤 mic     │ │          │ │          │            │
└─────────────┘ └──────────┘ └──────────┘            │
        │                                             │
        │  POST /api/transcribe (multipart audio)     │
        └─────────────────────────────────────────────┘
```

### Data Flow

#### Flow 1: Desktop hotkey recording
1. User presses global hotkey → popup appears at cursor
2. User clicks `[🎧 Internal Audio]` or `[🎤 Microphone]` → recording starts
3. Recording captured via BlackHole (internal) or system mic (external) as MP3
4. Popup shows timer + stop button. User clicks stop.
5. Desktop app POSTs MP3 to `POST /api/transcribe` with auth cookie
6. Server: save MP3 to `data/uploads/` → extract audio if video → Deepgram transcription (nova-2, Spanish, diarization) → LLM name detection → LLM action item extraction → save to DB → return result
7. Desktop shows "Done" notification
8. Telegram bot sends action items to user (if Telegram chat ID linked)

#### Flow 2: Telegram audio upload
1. User sends/forwards audio file to the Telegram bot
2. Telegram POSTs to `POST /api/telegram/webhook` on the Next.js server
3. Server downloads audio from Telegram → saves to `data/uploads/`
4. Same processing pipeline as Flow 1
5. Bot replies with: action items list + "📋 Copy Full Transcript" button + link to web UI

#### Flow 3: Web UI browsing
1. User opens `localhost:3000` in browser
2. History page shows all recordings (from both channels) with: filename, date, duration, speaker count
3. Click a recording → full transcript with speaker labels + action items card
4. "Copy Transcript" button copies entire text to clipboard
5. Settings page: manage API keys, Telegram link, BlackHole status

## Processing Pipeline

```
Audio File (MP3)
    │
    ▼
Deepgram Transcription
  • model: nova-2
  • language: Spanish (configurable)
  • diarization: true
  • smart_format, punctuate, paragraphs
    │
    ▼
Speaker Name Detection (LLM)
  • Prompt: "Map Speaker 0/1/2 to real names if mentioned"
  • Output: { "Speaker 0": "María", "Speaker 1": "Carlos" }
    │
    ▼
Action Item Extraction (LLM)
  • Prompt: "Extract action items. JSON: [{ task, assignee, deadline, context }]"
  • Model: deepseek/deepseek-r1-0528:free (fallback: deepseek/deepseek-r1:free)
  • Output: structured JSON array
    │
    ▼
Save to SQLite
  • recording metadata
  • full transcript text (with speaker labels + names)
  • action items JSON
    │
    ▼
Deliver
  • Telegram: action items + copy button (if TG linked)
  • Web UI: full transcript + action items card
  • Desktop: native notification "Done"
```

## Requirements

### Functional

1. **Desktop hotkey recording** — Global hotkey opens popup at cursor; select internal (BlackHole) or external (mic) audio source; toggle to stop; saves as MP3
2. **Telegram bot input** — Receive audio files via Telegram; process same pipeline; reply with action items + copy transcript button
3. **Deepgram transcription** — nova-2 model, Spanish default, speaker diarization, smart formatting, punctuation, paragraphs
4. **Speaker name detection** — LLM post-processing to map `Speaker 0`/`Speaker 1` to real names when mentioned in conversation
5. **Action item extraction** — LLM extracts structured action items (`task`, `assignee`, `deadline`, `context`) from transcript
6. **Telegram delivery** — Action items sent to user's Telegram with formatting; inline button to copy full transcript
7. **Web UI** — History of all recordings; full transcript view; action items card; copy transcript button
8. **API key management** — UI to enter Deepgram + OpenRouter keys; encrypted at rest (AES-256-GCM); session-scoped via iron-session
9. **Deepgram balance check** — Display credit balance in web UI
10. **Copy full transcript** — One-click copy to clipboard (Telegram inline button + web UI button)
11. **Menu bar icon** — Tauri app runs in menu bar; icon shows idle (🎙) / recording (🔴) / processing (⚙)
12. **Persistence** — All recordings (MP3), transcriptions, and action items persist in SQLite
13. **Local dev → Hetzner** — Runs on localhost; deployable to Hetzner VPS with ngrok for local dev (Telegram webhook needs public URL); no tunnel needed on Hetzner
14. **File cleanup** — Source MP3 deleted after successful transcription; outputs deleted when recording removed from history

### Non-Functional

1. **Security** — API keys encrypted at rest; never exposed to client; Telegram webhook verified via token
2. **Performance** — 2-4 minute transcription for 30-min meeting; action items extracted within 10s after transcription
3. **Reliability** — Graceful degradation when APIs unavailable; retry on 429
4. **macOS native feel** — Menu bar app, global hotkey, cursor-relative popup, native notifications
5. **Desktop binary size** — Tauri app <10MB

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Server | Next.js 16 (App Router) | API routes + Telegram webhook + web UI in one process |
| Language | TypeScript (strict) | Type safety everywhere |
| Desktop App | Tauri v2 (Rust + React) | Tiny binary, native macOS integration, global hotkey support |
| Styling | TailwindCSS + shadcn/ui | Web UI components |
| Database | SQLite via `better-sqlite3` | Single file, zero infra, local persistence |
| File Storage | Local filesystem (`data/`) | No cloud dependency |
| Auth | iron-session (sealed cookies) | Session-scoped API keys, no third-party auth |
| Audio Capture (internal) | BlackHole virtual audio driver | Standard for macOS internal audio loopback |
| Audio Capture (mic) | Tauri audio plugin / cpal | Native audio input |
| Transcription | Deepgram API (nova-2) | Proven Spanish + diarization |
| LLM | OpenRouter (DeepSeek R1) | Action items + name detection |
| Telegram | grammY (Node.js bot framework) | Clean API, middleware, webhook support |
| Tunneling (dev) | ngrok or cloudflared | Public URL for Telegram webhook on localhost |
| Key Encryption | Node.js crypto (AES-256-GCM) | Built-in, no extra dependency |
| Validation | zod | Request/response validation |

## Tauri Desktop App Design

### Menu Bar Icon

```
  🎙              ← idle
  🔴              ← recording
  ⚙              ← processing
```

Click icon → dropdown:
```
  ─────────────────
  🎤 Start Recording    (or hotkey)
  📋 Recent Transcriptions
  ⚙ Settings
  ─────────────────
  Quit
  ─────────────────
```

### Hotkey Popup (Option A — Two-step at cursor)

**Step 1 — Source selector** (appears at cursor position on hotkey press):

```
┌──────────────────────────────┐
│  Select Audio Source         │
│                              │
│  ┌────────────────────────┐  │
│  │  🎧  Internal Audio    │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  🎤  Microphone        │  │
│  └────────────────────────┘  │
│                              │
│         [Cancel]             │
└──────────────────────────────┘
```

**Step 2 — Recording indicator** (after source selected):

```
┌──────────────────────────────┐
│  🔴 Recording   00:04:32     │
│                              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  (audio level bar)           │
│                              │
│  ┌────────────────────────┐  │
│  │     ⏹  Stop Recording  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

### Tauri Rust Backend (responsibilities)
- Register global hotkey via `tauri-plugin-global-shortcut`
- Launch cursor-relative window on hotkey press
- Capture audio via `cpal` crate (mic) or BlackHole audio device (internal)
- Encode to MP3 via `minimp3` or ffmpeg binary
- POST MP3 to `localhost:3000/api/transcribe` with session cookie
- Show native notification on completion
- Manage menu bar icon state

### Tauri React Frontend (responsibilities)
- Render the source selector popup (Step 1)
- Render the recording indicator + stop button (Step 2)
- Communicate audio device selection to Rust backend via Tauri commands
- Receive recording duration updates from Rust

## API Design

### `POST /api/transcribe`
- **Purpose:** Upload audio for transcription + action item extraction
- **Request:** `multipart/form-data` — `file` (MP3), optional `language` (default `"es"`), optional `source` (`"desktop"` | `"telegram"`)
- **Processing:** Save file → transcribe (Deepgram) → detect names (LLM) → extract actions (LLM) → save to DB
- **Response:** `{ id, filename, duration, speakerCount, speakers: [{ id, name }], transcript: string, segments: TranscriptionSegment[], actionItems: ActionItem[] }`
- **Error codes:** 400, 401, 402, 413, 422, 500

### `POST /api/telegram/webhook`
- **Purpose:** Receive Telegram messages (webhook from Telegram servers)
- **Request:** Telegram Update object (JSON)
- **Handling:** Verify bot token → download audio file if present → call transcribe pipeline → send reply via Telegram API with action items + copy button
- **Response:** `200 OK` (always — Telegram retries on non-200)

### `GET /api/history`
- **Purpose:** List all recordings (both channels)
- **Response:** `{ recordings: Array<{ id, filename, source, createdAt, duration, speakerCount, actionItemCount }>, total: number }`

### `GET /api/history/[id]`
- **Purpose:** Get full recording detail
- **Response:** `{ id, filename, source, duration, transcript, segments: [{ timestamp, speakerName, text }], actionItems: [{ task, assignee, deadline, context }], createdAt }`

### `DELETE /api/history/[id]`
- **Purpose:** Delete recording + transcript + action items + files
- **Response:** `{ deleted: true }`

### `GET /api/balance`
- **Purpose:** Get Deepgram credit balance
- **Response:** `{ amount, units, amountCop }`

### `POST /api/keys` / `GET /api/keys`
- **Purpose:** Manage encrypted API keys (same as original spec)
- **Response:** `{ stored: ["deepgram"|"openrouter"] }` / `{ keys: { deepgram: string|null, openrouter: string|null } }`

### `POST /api/telegram/link`
- **Purpose:** Link a Telegram user to a web session (for cross-channel identity)
- **Request:** `{ telegramUserId: number }`
- **Response:** `{ linked: true }`

## Data Model

### Table: `recordings`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | TEXT (UUID) | yes | Primary key |
| `session_id` | TEXT | yes | Browser session that owns this |
| `filename` | TEXT | yes | Original filename |
| `source` | TEXT | yes | `"desktop"` or `"telegram"` |
| `duration_seconds` | REAL | yes | Audio duration |
| `speaker_count` | INTEGER | yes | Number of distinct speakers |
| `mp3_path` | TEXT | no | Local path to MP3 (deleted after processing) |
| `transcript_text` | TEXT | yes | Full transcription with speaker labels |
| `segments_json` | TEXT | yes | Array of `{ timestamp, speakerId, speakerName, text }` |
| `action_items_json` | TEXT | yes | Array of `{ task, assignee, deadline, context }` |
| `speaker_map_json` | TEXT | no | LLM-detected name mapping `{ "Speaker 0": "Name" }` |
| `model_used` | TEXT | yes | "nova-2" |
| `cost_usd` | REAL | no | Estimated transcription cost |
| `created_at` | TEXT | yes | ISO 8601 |

### Table: `api_keys`
(same as original spec — session-scoped, encrypted Deepgram + OpenRouter keys)

### Table: `telegram_links`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | TEXT (UUID) | yes | Primary key |
| `session_id` | TEXT | yes | Web session |
| `telegram_user_id` | INTEGER | yes | Telegram user ID |
| `telegram_chat_id` | INTEGER | yes | Chat ID for sending results |
| `created_at` | TEXT | yes | ISO 8601 |

## Web UI Design

### Page: Home (`/`)

```
┌──────────────────────────────────────────────────────────┐
│  🎙 conveneAI                              💰 $12.34 USD  │
│  Meeting Transcription + Action Items    🔑 Keys Set     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  📋 Recordings                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Reunión Lunes    🎤 Desktop   2h ago   34:12      │  │
│  │ 3 speakers  ·  5 action items      [📋 Copy] [👁] │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ Standup Daily    📱 Telegram   5h ago   12:03      │  │
│  │ 2 speakers  ·  2 action items      [📋 Copy] [👁] │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ ...                                                │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Page: Recording Detail (`/recording/[id]`)

```
┌──────────────────────────────────────────────────────────┐
│  ← Back                                                  │
│                                                          │
│  📄 Reunión Lunes · 34:12 · 🎤 Desktop                  │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │ Action Items     │  │ Transcript                   │ │
│  │                  │  │                              │ │
│  │ ✅ Review Q3     │  │ [00:00:05] María: Buenos...  │ │
│  │   → Carlos       │  │ [00:00:12] Carlos: Hola...   │ │
│  │   📅 Friday      │  │ [00:00:25] María: El tema... │ │
│  │                  │  │ [00:01:03] Carlos: Sí,...     │ │
│  │ ✅ Update deck   │  │ ...                          │ │
│  │   → María        │  │                              │ │
│  │   📅 Wednesday   │  │                              │ │
│  └──────────────────┘  └──────────────────────────────┘ │
│                                                          │
│  [📋 Copy Full Transcript]                                │
└──────────────────────────────────────────────────────────┘
```

## Telegram Bot UX

```
User: [sends audio file]

Bot:
  ✅ Transcrito — 34:12 — 3 speakers

  📋 Action Items:
  • Review Q3 budget → Carlos (by Friday)
  • Update investor deck → María (by Wednesday)
  • Schedule follow-up → María (by Monday)

  ┌─────────────────────────┐
  │ 📋 Copy Full Transcript │  ← inline button
  └─────────────────────────┘

  🔗 View in web UI: http://localhost:3000/recording/abc123
```

## Implementation Plan

### Phase 1 — Next.js Server Foundation (steps from original spec, adapted)
1. Scaffold Next.js 16 + TypeScript + Tailwind + shadcn/ui (flat structure)
2. Database layer (`lib/db.ts`) — SQLite tables: `recordings`, `api_keys`, `telegram_links`
3. Session utilities (`lib/session.ts`) — iron-session
4. Encryption utilities (`lib/crypto.ts`) — AES-256-GCM
5. Deepgram client wrapper (`lib/deepgram.ts`) — @deepgram/sdk ^3.11
6. OpenRouter client wrapper (`lib/openrouter.ts`) — with fallback
7. Action item extraction (`lib/action-extractor.ts`) — prompt → structured JSON
8. Speaker name detection (`lib/name-detector.ts`) — prompt → name mapping
9. FFmpeg utility (`lib/ffmpeg.ts`) — audio extraction if needed
10. API: Keys management
11. API: Transcribe (full pipeline)
12. API: History (list + detail + delete)
13. API: Balance
14. Web UI: Home page (history list + balance card + settings)
15. Web UI: Recording detail page (transcript + action items + copy button)
16. Web UI: Key setup dialog

### Phase 2 — Telegram Bot
17. Telegram bot setup (`lib/telegram-bot.ts`) — grammY, webhook mode
18. API: Telegram webhook — download audio, run pipeline, send reply
19. Telegram link endpoint — connect TG user to web session
20. ngrok/cloudflared tunnel setup for local dev

### Phase 3 — Tauri Desktop App
21. Scaffold Tauri v2 + React frontend (inside `desktop/` directory)
22. Menu bar icon — idle/recording/processing states
23. Global hotkey registration — `tauri-plugin-global-shortcut`
24. Cursor-position popup window — source selector (Step 1)
25. Recording indicator window — timer + stop button (Step 2)
26. Audio capture — BlackHole (internal) + system mic (external) via Rust
27. MP3 encoding via ffmpeg binary
28. HTTP client — POST to Next.js API with iron-session cookie
29. Native notifications on completion

### Phase 4 — Integration & Polish
30. End-to-end test: desktop recording → web UI → Telegram delivery
31. End-to-end test: Telegram upload → web UI → action items in chat
32. Copy-to-clipboard in both Telegram and web UI
33. Error handling: no BlackHole, invalid keys, API failures
34. Documentation: README with setup instructions (BlackHole install, ngrok, env vars)

## npm Packages

**Next.js server:**
```
@deepgram/sdk@^3.11      # Deepgram (pinned v3)
better-sqlite3           # SQLite
docx                     # DOCX generation (optional, for export)
jspdf                    # PDF generation (optional, for export)
fluent-ffmpeg            # Audio conversion
ffmpeg-static            # Bundled ffmpeg binary
zod                      # Validation
iron-session             # Session cookies
uuid                     # ID generation
grammy                   # Telegram bot framework
lucide-react             # Icons (shadcn/ui)
sonner                   # Toasts
react-dropzone           # Drag & drop (web upload fallback)
tailwindcss              # Styling
shadcn/ui                # UI components
```

**Tauri desktop (Rust/Cargo):**
```
tauri                     # Tauri framework
tauri-plugin-global-shortcut  # Global hotkeys
cpal                      # Audio input
hound                     # WAV encoding
```

## Environment Variables

```
# Next.js Server
ENCRYPTION_KEY=          # 256-bit hex for AES-256-GCM (openssl rand -hex 32)
SESSION_SECRET=          # 256-bit hex for iron-session (openssl rand -hex 32)
TELEGRAM_BOT_TOKEN=      # From @BotFather
TELEGRAM_WEBHOOK_URL=    # Public URL for webhook (ngrok URL in dev, VPS IP in prod)

# For ngrok (local dev only)
NGROK_AUTHTOKEN=         # ngrok auth token
```

## Design Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Next.js + Tauri + Telegram | Single backend server, three surfaces. All share one DB. |
| 2 | Local-first, Hetzner later | Develop on localhost. Deploy to VPS when ready. |
| 3 | SQLite via better-sqlite3 | Single file, zero infra. One DB shared by all channels. |
| 4 | Tauri v2 | Tiny binary, native macOS feel, menu bar + hotkey support. |
| 5 | Menu bar icon only | Background utility, not a dock app. Matches OpenSuperWhisper. |
| 6 | Two-step popup at cursor | Hotkey → select source → record. Fast, minimal eye travel. |
| 7 | Toggle recording (not hold) | Meetings are long. Hold-to-record is for dictation bursts. |
| 8 | BlackHole for internal audio | Standard macOS solution for system audio loopback. |
| 9 | MP3 output | Small files, Deepgram-compatible, sufficient for speech. |
| 10 | Action items as structured JSON | Clean Telegram formatting, web UI cards, future task tool integration. |
| 11 | Speaker name detection via LLM | Post-processing pass to map Speaker 0/1/2 → real names. |
| 12 | Fire-and-forget Telegram bot | Send audio → get action items + copy button. One clean response. |
| 13 | Telegram webhook (not polling) | Telegram pushes to us. No wasted requests. Ngrok tunnel in dev. |
| 14 | Auto-cleanup source MP3s | Delete after transcription. Outputs deleted on history removal. |
| 15 | Flat project structure | `app/`, `lib/`, `components/`, `desktop/` at root. |
| 16 | iron-session for BYOK scoping | Sealed cookies. Session-scoped encrypted keys. No third-party auth. |
| 17 | nova-2 for transcription | Proven for Spanish + diarization. Configurable. |
| 18 | DeepSeek R1 via OpenRouter for LLM | Free tier, fallback model on 429. Spanish-native. |
| 19 | grammY for Telegram bot | Clean API, middleware support, webhook-native. |
| 20 | ngrok tunnel for local dev | Telegram can't reach localhost. Public URL needed for webhook. |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| BlackHole not installed | Internal audio capture fails | Detect on app start, show one-click install guide |
| Deepgram SDK v4+ breaks API | Transcriptions fail | Pin to ^3.11, wrapper layer for easy migration |
| OpenRouter 429 on free tier | Action items / name detection fails | Model fallback, exponential backoff, clear error |
| Telegram webhook idle timeout | Missed messages during ngrok restart | Bot auto-retries; ngrok persistent tunnel |
| Large MP3 files (>100MB) on low memory | OOM during ffmpeg conversion | Stream to disk, never buffer entirely |
| Tauri global hotkey conflicts | Hotkey doesn't register | Configurable hotkey in settings; detect conflicts |
| `better-sqlite3` native compilation | Install fails on some systems | Pre-built binaries available for all platforms |
| Browser disconnects during long transcribe | User thinks process failed | Toast on completion; persistent "processing" state |

## Open Questions

1. **DOCX/PDF export** — The original app generates DOCX/PDF. Should the web UI offer downloadable exports? **Kept as optional** — the `docx` and `jspdf` packages are listed but not required for v1. The primary outputs are: copy-to-clipboard and Telegram delivery.

2. **Multiple Telegram users** — Currently one bot, one user. If multiple people use the bot in a group, who gets the action items? **Out of scope for v1.** Single-user assumption. Can add chat-based routing later.

3. **Real-time transcription** — Deepgram offers streaming. Could show words as they're spoken in the desktop popup. **v2 feature.** Pre-recorded batch is sufficient.

4. **Windows/Linux desktop app** — Tauri supports all platforms. BlackHole is macOS-only but Windows has stereo mix, Linux has PulseAudio loopback. **Out of scope for v1.** macOS only initially. Platform abstraction layer for audio makes this a follow-up task.

5. **Action item to task tool** — Could push action items to Notion, Linear, Todoist. **v2 feature.** The structured JSON output makes this straightforward — just add a destination handler.
