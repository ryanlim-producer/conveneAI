---
name: verify
description: Build, launch, and drive the conveneAI web UI locally to verify changes at the browser surface.
---

# Verifying conveneAI web UI changes

## Launch

```bash
npx next dev --port 3100        # port 3000 belongs to praxi — always use 3100
# app serves at http://localhost:3100/conveneai  (basePath!)
```

The app auto-creates `data/conveneai.db` on first request. **Delete `data/`
when done** — project policy is no local databases (CLAUDE.md).

## Seed a user + data

```bash
curl -s -X POST http://localhost:3100/conveneai/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"verify@test.local","password":"verify-pass-123"}'
# → {"userId":"<uuid>"} — use it to seed rows directly:
node -e "
const db = require('better-sqlite3')('data/conveneai.db');
db.prepare(\"INSERT INTO groups (id, user_id, name) VALUES ('grp-1', ?, 'Team')\").run('<uuid>');
db.prepare(\"INSERT INTO recordings (id, user_id, filename, source, duration_seconds, speaker_count) VALUES ('rec-1', ?, 'a.mp3', 'desktop', 125, 3)\").run('<uuid>');
"
```

## Drive with Playwright

`@playwright/test` is a project dep — run scripts **from the repo root**
(module resolution fails from /tmp). Login page labels work with
`getByLabel(/email/i)` / `getByLabel(/password/i)`; submit via
`getByRole("button", { name: /log in|sign in|iniciar/i })`. The history
list is on the home page (`/conveneai`). `locator.dragTo()` works for the
HTML5 drag-and-drop on recording grip handles (`drag-handle-<id>` →
`drop-section-<folderName>` / `drop-section-ungrouped`).

## Gotchas

- Client fetch URLs go through `api()` from `lib/api-path.ts` — raw curl
  must include the `/conveneai` prefix.
- Seeded state persists between script runs — reset rows before re-running,
  or drops onto the current section are silent no-ops by design.
- Dev overlay shows a pre-existing "button inside button" hydration warning
  from `components/ui/dropdown-menu.tsx` (trigger Button wrapped in its own
  `<button>`); not caused by list changes.
