# PRD: AsisVoz — Meeting Transcription + Action Items Platform

**Status:** ready-for-agent
**Date:** 2026-06-29
**Source spec:** `specs/SPEC-asisvoz-nextjs.md`

---

## Problem Statement

Meetings generate action items that get lost. The user attends Zoom calls, team syncs, and client meetings — all in Spanish — and needs to capture who said what, what needs to be done, and who's responsible. Currently, this means manual note-taking during meetings (distracting) or re-listening to recordings (time-consuming). There's no seamless way to go from "meeting happened" to "action items delivered."

The user wants two ways to capture meeting audio: a keyboard hotkey on their Mac (for recording any audio playing through their computer, like Zoom calls), and forwarding audio files through Telegram (for recordings made elsewhere). Both should produce the same result: a diarized transcript with speaker names, extracted action items, and the ability to copy the full text.

## Solution

AsisVoz is a local-first meeting intelligence platform with three surfaces sharing one database:

1. **Tauri desktop app** (macOS menu bar utility) — Press a global hotkey, select internal audio (BlackHole) or microphone, record the meeting, get a notification when processing is done
2. **Telegram bot** — Forward an audio file, get back a list of action items with a "Copy Full Transcript" button
3. **Next.js web UI** — Browse all recordings, view full transcripts with speaker labels, see action items, copy to clipboard

Under the hood: audio → Deepgram transcription (Spanish, nova-2, speaker diarization) → LLM name detection → LLM action item extraction → structured JSON → saved to SQLite → delivered to all surfaces.

The user provides their own Deepgram and OpenRouter API keys (BYOK model), encrypted at rest.

## User Stories

### Core Recording & Transcription

1. As a meeting participant, I want to press a global hotkey and select my audio source (internal or microphone), so that I can start recording a meeting in under 2 seconds without breaking my flow
2. As a meeting participant, I want to see a recording timer and audio level indicator at my cursor while recording, so that I know it's working without looking away
3. As a meeting participant, I want to stop recording with a single click, so that I don't need to remember another keyboard shortcut
4. As a user, I want my recording automatically transcribed with speaker diarization, so that I can see who said what without manual labeling
5. As a user, I want speakers identified by their real names when mentioned in conversation (e.g., "Speaker 0" → "María"), so that the transcript reads naturally
6. As a user, I want my transcript in Spanish with proper punctuation and formatting, so that it's readable without cleanup

### Action Items

7. As a meeting participant, I want action items automatically extracted from the transcript (who needs to do what, by when), so that I don't have to manually comb through the conversation
8. As a meeting participant, I want action items delivered to my Telegram immediately after processing, so that I have them on my phone where I act on tasks
9. As a user, I want to see action items alongside the full transcript in the web UI, so that I can verify them against the original conversation

### Telegram Integration

10. As a user, I want to forward an audio file to my Telegram bot and receive action items back, so that I can get meeting intelligence from recordings I didn't make on my computer
11. As a user, I want a "Copy Full Transcript" inline button in the Telegram response, so that I can paste the transcript wherever I need it with one tap
12. As a user, I want my Telegram identity linked to my web session, so that recordings from both channels appear in the same history

### Web UI

13. As a user, I want to see all my recordings (from desktop and Telegram) in a single chronological list, so that I don't have to remember which channel I used
14. As a user, I want to view a full transcript with speaker labels and timestamps, so that I can reference specific parts of the conversation
15. As a user, I want to copy the entire transcript to my clipboard with one click, so that I can paste it into notes, docs, or share it
16. As a user, I want to see my Deepgram credit balance in the web UI, so that I know when I'm running low

### Setup & Security

17. As a user, I want to enter my Deepgram and OpenRouter API keys once and have them encrypted, so that my keys are never exposed
18. As a user, I want the app to validate my API keys on entry and tell me immediately if they're invalid, so that I don't discover this when I try to transcribe
19. As a user, I want a clear setup guide for installing BlackHole (the virtual audio driver) if it's not already installed, so that internal audio recording works

### Persistence & Cleanup

20. As a user, I want all my recordings, transcriptions, and action items to persist across app restarts, so that my history is always available
21. As a user, I want to delete a recording and have its transcript and action items also removed, so that I can manage my storage
22. As a user, I want the source MP3 file automatically deleted after successful transcription, so that I don't accumulate gigabytes of raw audio

### Desktop App Experience

23. As a user, I want the desktop app to live in my menu bar (not my dock), so that it's always accessible but never in the way
24. As a user, I want the menu bar icon to show recording state (idle/recording/processing), so that I can glance and know what's happening
25. As a user, I want the source selector popup to appear at my mouse cursor, so that I don't have to move my eyes across the screen

### Deployment

26. As a user, I want everything to run on localhost during development, so that I can iterate quickly without internet dependencies for the app itself
27. As a user, I want to eventually deploy the Next.js server to my Hetzner VPS, so that the Telegram bot and web UI are available even when my laptop is off

## Implementation Decisions

### Architecture

- **Three-surface architecture**: Next.js server is the single source of truth. Tauri desktop app and Telegram bot are input/output channels. All share one SQLite database.
- **Local-first, Hetzner-later**: Develop on localhost. Deploy Next.js to Hetzner VPS when ready. Desktop app connects to either localhost or remote API via configurable URL.
- **Flat Next.js project structure**: `app/`, `lib/`, `components/`, `desktop/` at root. No `src/` nesting.
- **Synchronous API processing**: Transcription runs inline in the API route. No job queue or polling needed locally (no timeout constraint). Same approach works on Hetzner with longer timeouts.

### Audio Capture

- **BlackHole for internal audio**: User installs BlackHole virtual audio driver once. Desktop app selects it as input device. One-click setup guide shown if not detected.
- **System microphone for external**: Standard audio input via Tauri's audio plugin.
- **MP3 output**: Encode to MP3 at 128kbps. Sufficient for speech, Deepgram-compatible, small file size.
- **Toggle recording model**: Press hotkey once → select source → recording starts. Press stop button to end. NOT hold-to-record (meetings are long).

### Desktop App

- **Tauri v2**: Rust backend for native macOS integration (global hotkey, audio capture, menu bar). React frontend for the cursor popup UI (source selector, recording indicator).
- **Menu bar icon only**: No dock icon. Icon states: idle (🎙), recording (🔴), processing (⚙). Click for dropdown menu.
- **Two-step popup at cursor**: Hotkey → Step 1: select audio source (two buttons) → Step 2: recording indicator with timer + audio level bar + stop button.
- **Configurable hotkey**: Default to Ctrl+Shift+R or similar. User-configurable in settings.
- **Native notification on completion**: macOS notification when transcription + action items are ready.

### Transcription Pipeline

- **Deepgram nova-2**: Spanish, diarization, smart_format, punctuation, paragraphs. Model pinned to SDK v3.11 (v4+ has breaking API changes).
- **Speaker name detection**: Secondary LLM call. Prompt asks to map `Speaker 0`/`Speaker 1`/etc. to real names if mentioned in the conversation. Returns a JSON mapping. Falls back to "Speaker N" labels.
- **Action item extraction**: LLM call with structured output prompt. Returns JSON array: `[{ task, assignee, deadline, context }]`. Model: `deepseek/deepseek-r1-0528:free` with fallback to `deepseek/deepseek-r1:free` on 429.
- **Full text context**: Send entire transcript to LLM for both name detection and action extraction. Error if transcript exceeds context window.

### Telegram Bot

- **grammY framework**: Clean API, webhook-native, middleware support.
- **Webhook mode** (not polling): Telegram pushes updates to the Next.js server. No wasted requests. Requires public URL (ngrok in dev, VPS IP in prod).
- **Fire-and-forget UX**: Send audio → bot replies with action items + inline "Copy Full Transcript" button + link to web UI. One message in, one message out.
- **Telegram link**: User links their Telegram identity to their web session via a one-time code or by opening the web UI from Telegram.

### Storage & Persistence

- **SQLite via better-sqlite3**: Three tables: `recordings` (transcript, segments, action items, speaker map), `api_keys` (encrypted Deepgram + OpenRouter keys, session-scoped), `telegram_links` (session ↔ Telegram user mapping).
- **Local filesystem**: `data/uploads/` for incoming MP3s (auto-deleted after processing), `data/output/` for any generated exports.
- **Auto-cleanup**: Source MP3 deleted after successful transcription. All files deleted when recording removed from history.

### Security

- **BYOK encryption**: API keys encrypted with AES-256-GCM using server-side `ENCRYPTION_KEY` env var. Keys never returned to client. Masked display only (e.g., `deep***3xyz`).
- **iron-session**: Sealed, encrypted cookies for session management. Session ID scopes API keys and recording history. No third-party auth service.
- **Telegram webhook verification**: Validate incoming webhook requests using the bot token.

### API Contracts

- `POST /api/transcribe` — multipart upload (MP3 file + optional language), returns `{ id, filename, duration, speakerCount, speakers, transcript, segments, actionItems }`. Synchronous processing.
- `POST /api/telegram/webhook` — receives Telegram Update JSON, downloads audio, runs full pipeline, sends reply via Telegram API. Always returns 200.
- `GET /api/history` — list all recordings (both channels). Returns `{ recordings: [...], total }`.
- `GET /api/history/[id]` — full recording detail with transcript segments and action items.
- `DELETE /api/history/[id]` — delete recording + transcript + action items + files.
- `GET /api/balance` — Deepgram credit balance (USD + COP).
- `POST /api/keys` / `GET /api/keys` — manage encrypted API keys.
- `POST /api/telegram/link` — link Telegram user to web session.

### Web UI

- **Home page**: History list (all recordings from both channels) with filename, source icon, date, duration, speaker count, action item count. Each row has "Copy Transcript" and "View Detail" buttons.
- **Recording detail page**: Side-by-side layout — action items card on the left, full transcript with speaker labels and timestamps on the right. "Copy Full Transcript" button at the bottom.
- **Key setup dialog**: Modal with Deepgram key + OpenRouter key fields, masked input, validation on save.
- **Balance card**: Header shows current Deepgram balance with refresh.
- **9 shadcn/ui components**: Button, Input, Dialog, Card, ScrollArea, Sonner (toast), Separator, Skeleton, Badge.
- **All components handle 4 states**: Loading (skeleton), Empty (friendly message with action), Error (specific message with fix suggestion), Success.

### Progress Feedback

- **Simple spinner**: Client shows "Transcribing…" with animated spinner during the synchronous POST. No SSE or polling for v1. The fetch resolves when processing is complete. Toast notification on completion or error.

## Testing Decisions

### Seam Architecture

Tests are written at the highest possible seams. External services (Deepgram, OpenRouter, Telegram API) are mocked at the HTTP level.

| Seam | Level | What it tests |
|------|-------|--------------|
| `POST /api/transcribe` | Integration (primary) | Full pipeline: upload → transcribe → name detection → action extraction → DB persistence → response shape. Mock Deepgram + OpenRouter. |
| `POST /api/telegram/webhook` | Integration | Telegram entry point: webhook verification → audio download → pipeline → reply formatting. Mock Telegram API. |
| `lib/deepgram.ts` | Unit | Deepgram options are passed correctly, retry on 429, response parsing. Mock HTTP layer. |
| `lib/openrouter.ts` | Unit | Model fallback on 429, structured prompt construction, response parsing. Mock HTTP layer. |
| `lib/crypto.ts` | Unit | Encrypt/decrypt round-trip, tampered data rejection. Pure functions, no mocking needed. |
| `lib/action-extractor.ts` | Unit | Prompt construction, JSON parsing, error handling on malformed LLM output. Mock OpenRouter wrapper. |
| Tauri IPC commands | Unit | `start_recording` → audio capture → MP3 encoding → POST. `stop_recording` → state transition. Mock audio input. |

### What Makes a Good Test

- Tests exercise external behavior only — what the API returns and what side effects happen (DB writes, Telegram sends), not internal implementation details
- Mock at the HTTP boundary (mock Deepgram's REST API, mock OpenRouter's REST API, mock Telegram's sendMessage endpoint)
- Error paths are tested as thoroughly as happy paths (invalid keys, 429 rate limits, empty transcripts, no speech detected, missing BlackHole)
- Each test is independent — it creates its own recording, processes it, asserts on the result, and cleans up

### Test Framework

- **Vitest** for unit and integration tests (Node.js environment, fast startup, JSX support)
- **Playwright** for browser tests (web UI: upload flow, history browsing, copy-to-clipboard, key setup dialog)
- **Tauri mock** for desktop IPC tests (invoke commands, verify state transitions)

## Out of Scope

- **Real-time streaming transcription** — Pre-recorded batch only for v1. Deepgram streaming can be added later.
- **Multi-user / team support** — Single user, single session. The BYOK model and iron-session assume one human using the app.
- **DOCX/PDF export** — The original desktop app generated Word and PDF files. v1 focuses on copy-to-clipboard and Telegram delivery. Export packages (`docx`, `jspdf`) are listed as optional dependencies.
- **Windows/Linux desktop app** — macOS only initially. Tauri supports all platforms but BlackHole is macOS-only. Platform audio abstraction is a follow-up.
- **Action item push to task tools** — The structured JSON output makes Notion/Linear/Todoist integration straightforward, but it's not in v1.
- **Multiple Telegram users/groups** — One bot, one linked user. Group chat routing is a follow-up.
- **Custom Deepgram model selection** — nova-2 is the default. The API accepts a `model` parameter but the UI doesn't expose it in v1.
- **Mobile web UI** — Desktop-first web UI. Responsive but not mobile-optimized. The Telegram bot is the mobile interface.

## Further Notes

### Development Workflow

- **Phase 1**: Next.js server (API + web UI) — can be tested independently with curl and browser
- **Phase 2**: Telegram bot — requires ngrok tunnel for local webhook testing
- **Phase 3**: Tauri desktop app — requires BlackHole installed for internal audio
- **Phase 4**: Integration — end-to-end across all three surfaces

### Local Dev Setup (documented in README)

1. `npm install` — Node.js dependencies
2. `cp .env.example .env` — fill in API keys + bot token
3. `npm run dev` — start Next.js on localhost:3000
4. `ngrok http 3000` — get public URL for Telegram webhook
5. Set Telegram webhook to ngrok URL
6. Install BlackHole: `brew install blackhole-2ch`
7. `cd desktop && npm run tauri dev` — start desktop app

### Hetzner Deployment (future)

1. Clone repo to VPS
2. `npm install && npm run build && npm start` (or PM2)
3. Point Telegram webhook to VPS public IP
4. Desktop app: change API URL from localhost to VPS IP
5. SQLite file lives on VPS; back up regularly

### Key Dependency Versions

- `@deepgram/sdk@^3.11` — **must** stay on v3.x (v4+ has breaking API changes, verified 2026-06-25)
- `better-sqlite3` — requires native compilation; pre-built binaries available for macOS ARM64, x64, Linux
- `@libsql/client` — **no longer used** (was considered for Turso, but we settled on local SQLite)
- `grammy` — Telegram bot framework, webhook mode
- `tauri` v2 — desktop app framework, Rust backend
