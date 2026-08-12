# Implementation Report: folder-card-ui — Iteration 1

## What was built
Folder-first card grid navigation: replaced flat recording grid on the home page with a two-tier folder→recording model. Added folder cards, folder detail pages, and PATCH/DELETE API routes for group management.

## Divergences from spec
- Step 3 (PATCH/DELETE `/api/groups/[id]`) was already implemented in the route file and had existing tests — no new code needed.
- `FolderData` interface uses `lastActivity: string | null` (nullable) to match the `COALESCE` from the SQL, while the spec shows `lastActivity: string`. The null case handles the theoretical edge case where both `MAX(r.created_at)` and `g.created_at` return NULL.
- Folder detail page uses `window.location.href = "/"` for post-delete navigation instead of `router.push("/")` to ensure a hard reload picks up the latest data.
- Added an error state to HomeContent (was missing — the old code only rendered a count-0 hero on error).

## Unresolved caveats
- List view inside folder detail pages delegates to `HistoryList` which is not scoped to the folder — it shows all recordings. This is a known gap; the spec says to scope it but `HistoryList` has its own independent fetch logic.
- View toggle state is not persisted across page reloads (no localStorage).
- Folder detail rename does not update the URL slug (the folder ID is used, not the name).
- The `useRecordings` hook always fetches `/api/groups` (harmless but wasteful on folder detail pages where folder data is already provided by the server component).

## Key files changed
- `app/api/groups/route.ts` — added `lastActivity` via COALESCE subquery
- `app/api/history/route.ts` — added optional `?groupId=` query parameter
- `components/home-content.tsx` — restructured to folder-first layout with ungrouped section, new folder dialog, ViewToggle component
- `components/folder-card.tsx` — NEW: amber badge, recording count, last activity, rename/delete menus
- `components/folder-card-grid.tsx` — NEW: responsive grid wrapper
- `components/folder-detail-content.tsx` — NEW: breadcrumb, header, search, view toggle, scoped recordings
- `app/folder/[id]/page.tsx` — NEW: server component with auth + ownership check
- `hooks/use-recordings.ts` — added optional `{ groupId }` parameter
- `components/creation-module.tsx` — added optional `folderId` prop
- `app/api/groups/route.test.ts` — added lastActivity tests
- `app/api/history/route.test.ts` — added groupId filter test

## Test results
- 53 passed (all groups + history tests, including 3 new), 0 failed
- 7 pre-existing failures in `lib/pipeline.test.ts` (unrelated mock issue)
- TypeScript: clean compile, no errors
