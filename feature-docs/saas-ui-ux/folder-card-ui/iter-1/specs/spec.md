# Spec: Folder Card UI — Grid View as Folder-First Navigation

**Feature:** saas-ui-ux
**Implementation:** folder-card-ui
**Iteration:** 1
**Status:** ready-for-implementation
**Source:** 16-point grilling session on 2026-08-12, building on the app shell from `improvement-to-uiux`

---

## Overview

Replace the recording-level card grid on the "All Recordings" home page with a **folder-first card grid**. Folder cards are the primary grid-view abstraction. Recording cards appear only in the "Ungrouped Recordings" section (above folders) and inside folder detail pages (`/folder/[id]`). The list view (`HistoryList`) remains unchanged as the power-user management interface.

This shifts the home page from a flat recording list to a two-tier navigation model: **folders → recordings**, matching how users mentally organize their meetings.

---

## 1. Architecture

### 1.1 Page Layout (Grid View)

```
Home Page (grid view)
├── CreationModule (progressive: hero / compact bar, optional folderId)
├── if ungrouped.length > 0:
│   └── "Ungrouped Recordings" section
│       └── RecordingCardGrid → RecordingCard[]
├── if folders.length > 0:
│   └── "Your Recordings" section header: [+ New Folder] [Search] [≡ view toggle]
│       └── FolderCardGrid → FolderCard[]
└── if both empty:
    └── CreationModule hero (empty state)
```

### 1.2 Folder Detail Page Layout (`/folder/[id]`)

```
Folder Detail Page
├── Breadcrumb: "← All Folders" (Link to /)
├── Folder header: amber icon + name (h1) + metadata + [Rename] [Delete]
├── CreationModule (count, folderId=id)
├── if recordings.length === 0:
│   └── Empty: "No recordings in this folder yet. Upload one to get started."
└── if recordings.length > 0:
    └── Section header: "Recordings in [folderName]" [Search] [≡]
        └── view === "grid" ? RecordingCardGrid : HistoryList (scoped)
```

### 1.3 Data Flow

- `GET /api/groups` — returns `{ id, name, recordingCount, lastActivity, createdAt }` for the authenticated user
- `GET /api/history` — returns all recordings with `groupId` and `groupName`
- `GET /api/history?groupId=X` — NEW: returns only recordings in group X
- `POST /api/groups` — existing: creates a group
- `PATCH /api/groups/[id]` — NEW: renames a group (ownership-gated)
- `DELETE /api/groups/[id]` — NEW: deletes a group, sets recordings' `group_id` to NULL (ownership-gated)

### 1.4 New Routes

| Route | Method | Purpose |
|---|---|---|
| `/folder/[id]` | Page | Folder detail page (server component + client content) |
| `/api/groups/[id]` | PATCH | Rename a group |
| `/api/groups/[id]` | DELETE | Delete a group (recordings become ungrouped) |

---

## 2. Requirements

### 2.1 Functional

1. **Folder cards replace recording cards** in the grid view on the home page
2. **Ungrouped recordings** appear in a separate "Ungrouped Recordings" section ABOVE the folder grid, using existing `RecordingCard` components
3. **Clicking a folder card** navigates to `/folder/[id]` showing recordings within that folder
4. **"+ New Folder"** button in the "Your Recordings" section header opens a dialog (name input + Save/Cancel) → `POST /api/groups`
5. **Folder rename** via "…" menu → dialog with pre-filled name → `PATCH /api/groups/[id]` with `{ name }`
6. **Folder delete** via "…" menu → confirmation dialog ("N recordings will become ungrouped") → `DELETE /api/groups/[id]`
7. **Search** filters both folder names and recording filenames simultaneously across both sections
8. **View toggle** switches between folder grid + ungrouped (grid icon) and existing `HistoryList` (list icon)
9. **Empty folders** (0 recordings) appear as folder cards with "0 recordings" and `createdAt` as fallback date
10. **0 folders** → only the ungrouped section renders; no empty folder grid, no "Your Recordings" header
11. **0 ungrouped** → ungrouped section disappears entirely; no "all in folders" message
12. **Folder detail page** (`/folder/[id]`) reuses the `HomeContent` pattern scoped to one folder
13. **Folder detail breadcrumb** = "← All Folders" links back to `/`
14. **Compact upload bar** on folder detail page links to `/upload?folderId=X` to pre-fill the folder
15. **Existing list view** (`HistoryList`) is unchanged — full drag-and-drop, group management
16. **`useRecordings` hook** accepts optional `groupId` to filter by folder

### 2.2 Non-Functional

- Folder cards must match the visual density and calm feel of the app shell
- Folder detail page handles 100+ recordings via search + scroll (no explicit pagination in iter-1)
- Folder rename/delete operations show loading states and toast feedback
- Navigation to `/folder/[id]` supports browser back/forward and deep-linking
- All new API routes are auth-gated via `withAuth`
- PATCH/DELETE `/api/groups/[id]` verify group ownership (user_id match)

---

## 3. Implementation Plan

### 3.1 Files to Create

| File | Purpose |
|---|---|
| `components/folder-card.tsx` | Folder card: amber icon badge, name, recording count, last activity, "…" menu |
| `components/folder-card-grid.tsx` | Responsive grid (`auto-fill, minmax(280px, 1fr)`) of `FolderCard` |
| `app/folder/[id]/page.tsx` | Server component: resolves group by id, verifies auth + ownership, renders client content |
| `components/folder-detail-content.tsx` | Client component: folder header, breadcrumb, search, view toggle, recording grid/list |
| `app/api/groups/[id]/route.ts` | PATCH (rename) + DELETE (delete, ungroup recordings) |

### 3.2 Files to Modify

| File | Change |
|---|---|
| `components/home-content.tsx` | Replace `RecordingCardGrid` with folder grid + ungrouped section. Split recordings into `ungrouped` and `grouped`. Add `+ New Folder` button to section header. Wire search to filter both folder names and recording filenames. |
| `hooks/use-recordings.ts` | Add optional `{ groupId?: string }` parameter. Fetch from `/api/history?groupId=X` when provided. |
| `app/api/groups/route.ts` | Add `lastActivity` field to GET response: `COALESCE(MAX(r.created_at), g.created_at)` |
| `app/api/history/route.ts` | Accept optional `groupId` query parameter to filter by group |
| `components/creation-module.tsx` | Accept optional `folderId` prop — links to `/upload?folderId=X` when set |

### 3.3 Files to Delete

None.

### 3.4 Step-by-Step

**Step 1: Backend — Add lastActivity to GET /api/groups**

Modify SQL in `handleListGroups` to include:
```sql
COALESCE(
  (SELECT MAX(r.created_at) FROM recordings r
   WHERE r.group_id = g.id AND r.user_id = g.user_id),
  g.created_at
) AS last_activity
```
Add `lastActivity` to the response mapping. No breaking change (additive field). `COALESCE` ensures empty folders show their creation date as fallback.

**Step 2: Backend — Add groupId filter to GET /api/history**

Accept `?groupId=X` query parameter in `handleListHistory`. When present and non-empty, add `AND r.group_id = ?` to the WHERE clause, binding the parameter. When absent, existing behavior (all recordings). Validate that `groupId` is a non-empty string.

**Step 3: Backend — Create PATCH + DELETE /api/groups/[id]**

New file `app/api/groups/[id]/route.ts`:

- **PATCH**: Parse `{ name }` from body. Validate non-empty string. Look up group by id, verify `user_id === ctx.user.userId` (return 404 if mismatch — don't leak existence). Check uniqueness of new name. Update `groups SET name = ?`. Return updated group JSON.
- **DELETE**: Look up group by id, verify ownership (same 404-on-mismatch pattern). Count recordings in group. `UPDATE recordings SET group_id = NULL, group_name = NULL WHERE group_id = ?`. `DELETE FROM groups WHERE id = ?`. Return `{ deleted: true, ungroupedCount: N }`.

Both wrapped with `withAuth`.

**Step 4: Frontend — FolderCard component**

```typescript
interface FolderData {
  id: string;
  name: string;
  recordingCount: number;
  lastActivity: string | null;  // SQLite UTC timestamp
  createdAt: string;
}
```

Card layout: amber `bg-amber-100 text-amber-700` rounded-square (32px) with `Folder` icon top-left. Folder name `font-medium` `line-clamp-2`. Metadata row: `"12 recordings"` left, `"Updated Aug 12"` right (using `lastActivity`). "…" more menu (always visible, same pattern as `RecordingCard`) with Rename → dialog and Delete → confirmation dialog. Entire card wrapped in `<Link href={/folder/${id}}>`.

Rename dialog: `Dialog` + `DialogHeader`("Rename folder") + `Input` (pre-filled with current name) + Cancel/Save buttons. Save calls `PATCH /api/groups/[id]` with `{ name }`.

Delete dialog: `Dialog` + warning text ("12 recordings will become ungrouped") + Cancel/Delete buttons. Delete calls `DELETE /api/groups/[id]`, on success calls `onRefresh`.

**Step 5: Frontend — FolderCardGrid component**

Responsive grid: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, `gap-4`. Maps over folders array, renders `FolderCard` for each. Same pattern as `RecordingCardGrid`.

**Step 6: Frontend — Update HomeContent**

Restructure the component:

```typescript
// Split recordings
const ungrouped = useMemo(
  () => (filtered ?? []).filter(r => !r.groupId),
  [filtered]
);

// Folders come from useRecordings hook (already fetched)
const { recordings, folders, loading, refresh } = useRecordings();

// Search filters both
const filteredFolders = useMemo(() => {
  if (!search.trim()) return folders;
  const q = search.toLowerCase();
  return folders.filter(f => f.name.toLowerCase().includes(q));
}, [folders, search]);

const filteredRecordings = useMemo(() => {
  if (!recordings) return null;
  if (!search.trim()) return recordings;
  const q = search.toLowerCase();
  return recordings.filter(r => r.filename.toLowerCase().includes(q));
}, [recordings, search]);
```

Render logic:
- `ungrouped.length > 0` → "Ungrouped Recordings" header + `RecordingCardGrid`
- `filteredFolders.length > 0` → "Your Recordings" header with `+ New Folder` button + search + view toggle + `FolderCardGrid`
- Both empty → `CreationModule` hero (empty state)

"+ New Folder" button opens a `Dialog` with name `Input` + Save/Cancel. Save calls `POST /api/groups` with `{ name }`, refreshes on success.

**Step 7: Frontend — Update useRecordings hook**

```typescript
export function useRecordings(options?: { groupId?: string }): UseRecordingsReturn {
  const { groupId } = options ?? {};
  // ...
  const historyUrl = groupId
    ? api(`/api/history?groupId=${encodeURIComponent(groupId)}`)
    : api("/api/history");
  // fetch historyUrl instead of hardcoded api("/api/history")
}
```

Always fetch `/api/groups` for folders (needed on home page, harmless on folder detail page).

**Step 8: Frontend — Folder detail page**

`app/folder/[id]/page.tsx` (server component):
- Fetch group by id from DB
- Verify group exists and belongs to authenticated user (404 if not)
- Pass group data to `FolderDetailContent`

`components/folder-detail-content.tsx` (client component):
- Breadcrumb: `<Link href="/"><ArrowLeft /> All Folders</Link>`
- Folder header: amber `Folder` icon + `folder.name` (h1) + `"12 recordings · Created Jun 3, 2025"` + Rename/Delete buttons
- `CreationModule` with `folderId` prop (links to `/upload?folderId=...`)
- Recording grid/list using `useRecordings({ groupId: folder.id })`
- Empty state when no recordings: centered text with upload CTA

**Step 9: Frontend — CreationModule folderId prop**

Add optional `folderId?: string` prop. When set, the Upload button's `href` becomes `/upload?folderId=${folderId}` instead of `/upload`. Used on folder detail page. The upload page will read `?folderId` and pre-select that folder (handled separately or in iter-2; for iter-1 the query param is passed, upload page may ignore it).

**Step 10: Polish pass**

- Loading skeletons: 3 `Skeleton` cards matching folder card dimensions
- Folder detail loading: skeleton for header + skeleton cards
- Error state in folder detail: "Folder not found" if API returns 404
- Edge case: user deletes folder in another tab → folder detail page shows "This folder has been deleted" with link back to `/`
- Edge case: folder renamed in another tab → `useRecordings` refresh picks up new name
- Empty folder detail: "No recordings in this folder yet. Upload one to get started." with upload button

---

## 4. API Design

### 4.1 `GET /api/groups` (modified — add lastActivity)

**Response 200:**
```json
{
  "groups": [
    {
      "id": "abc123",
      "name": "Team Standups",
      "recordingCount": 12,
      "lastActivity": "2026-08-12 09:30:00",
      "createdAt": "2026-06-03 14:00:00"
    }
  ]
}
```

`lastActivity` is `COALESCE(MAX(r.created_at), g.created_at)` — for empty folders, it falls back to the folder's own creation date.

### 4.2 `GET /api/history?groupId=X` (new query param)

- **Query:** `?groupId=<uuid>` (optional)
- **When present:** filters recordings WHERE `r.group_id = ?`
- **When absent:** existing behavior (all recordings for user)
- **Invalid groupId:** treated as absent (returns all recordings)

### 4.3 `PATCH /api/groups/[id]` (new)

- **Purpose:** Rename a group
- **Auth:** `withAuth` + ownership check (`user_id` must match)
- **Request:** `{ name: string }` — non-empty, trimmed
- **Response 200:** `{ id: string, name: string, recordingCount: number, lastActivity: string, createdAt: string }`
- **Response 400:** name is empty or not a string
- **Response 404:** group not found or doesn't belong to authenticated user (don't leak existence)
- **Response 409:** a group with this name already exists for this user

### 4.4 `DELETE /api/groups/[id]` (new)

- **Purpose:** Delete a group; all its recordings become ungrouped
- **Auth:** `withAuth` + ownership check (`user_id` must match)
- **Request:** none
- **Response 200:** `{ deleted: true, ungroupedCount: number }`
- **Response 404:** group not found or doesn't belong to authenticated user
- **Side effect:** `UPDATE recordings SET group_id = NULL, group_name = NULL WHERE group_id = ?` then `DELETE FROM groups WHERE id = ?`

---

## 5. Data Model

No schema changes. The existing tables are sufficient:

```
groups: id (TEXT PK), user_id (FK→users), name (TEXT), created_at (TEXT)
recordings: ... group_id (FK→groups, NULLABLE), group_name (TEXT, denormalized, NULLABLE)
```

---

## 6. Frontend Changes

### 6.1 New Components

| Component | Props | Notes |
|---|---|---|
| `FolderCard` | `{ folder: FolderData, onRefresh: () => void }` | Amber icon badge, name, count, date, "…" menu |
| `FolderCardGrid` | `{ folders: FolderData[], onRefresh: () => void }` | Responsive grid, maps FolderCard |
| `FolderDetailContent` | `{ folder: FolderData }` | Breadcrumb, header, creation bar, recording grid/list |

### 6.2 Modified Components

| Component | Change |
|---|---|
| `HomeContent` | Split into ungrouped + folder grid. "+ New Folder" button. Search filters both. |
| `CreationModule` | New optional `folderId` prop — changes upload link target. |
| `useRecordings` | New optional `{ groupId }` parameter — filters history fetch. |

### 6.3 CSS / Visual Tokens

No new CSS tokens. Folder cards reuse:
- `bg-card`, `border-border`, `rounded-xl` (card surface)
- `bg-amber-100 text-amber-700` (folder icon badge)
- `hover:shadow-md` (card hover)

---

## 7. Testing Strategy

### 7.1 Vitest (Unit Tests)

| Test | What it verifies |
|---|---|
| `PATCH /api/groups/[id]` success | Rename with valid name returns updated group |
| `PATCH /api/groups/[id]` empty name | Returns 400 |
| `PATCH /api/groups/[id]` duplicate name | Returns 409 |
| `PATCH /api/groups/[id]` not owner | Returns 404 (don't leak existence) |
| `DELETE /api/groups/[id]` success | Returns `{ deleted: true, ungroupedCount }`, recordings ungrouped |
| `DELETE /api/groups/[id]` not owner | Returns 404 |
| `GET /api/history?groupId=X` | Returns only recordings in that group |
| `GET /api/groups` lastActivity | Includes `lastActivity` field, NULL for empty folders falls back to `createdAt` |

### 7.2 Playwright (Browser Tests)

| Test | What it verifies |
|---|---|
| Grid view shows folder cards | Folders render as cards in "Your Recordings" section |
| Ungrouped recordings in separate section | Recordings without group_id appear above folders |
| Click folder card navigates | Navigates to `/folder/[id]`, breadcrumb visible |
| Folder detail page shows recordings | Recordings in folder render as cards |
| "+ New Folder" creates folder | Dialog opens, name entered, card appears |
| Rename folder | "…" menu → dialog → name updated on card |
| Delete folder | "…" menu → confirmation → card removed |
| Search filters both sections | "standup" matches folder name AND recording filename |
| View toggle switches views | Grid ↔ list toggle works |
| Empty folder shows 0 count | "0 recordings" on card, "No recordings yet" on detail page |
| 0 folders → only ungrouped | No "Your Recordings" header when no folders |
| 0 ungrouped → no section | "Ungrouped Recordings" section absent |

### 7.3 Manual Verification

1. Navigate to `/` with folders + ungrouped recordings → verify layout
2. Click folder card → verify navigation and breadcrumb
3. "+ New Folder" → create, verify card appears
4. Rename folder → verify card updates
5. Delete folder → verify card disappears, recordings now ungrouped on home page
6. Search "team" → both folder "Team Standups" and recording "team-sync.mp3" visible
7. Toggle to list view → verify `HistoryList` works as before
8. Browser back from folder detail → verify return to `/`

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `lastActivity` subquery slow with many recordings | Low — SQLite MAX on indexed FK column | `COALESCE` fallback to `g.created_at`. If slow in practice, cache in the group row. |
| Two-tier navigation unfamiliar to existing users | Medium | List view toggle is one click away — zero change to the power-user workflow. Folder cards clearly labeled with recording counts. |
| Folder delete ungroups many recordings | Low — no data loss, just reorganization | Confirmation dialog shows exact count. Recordings remain accessible in "Ungrouped Recordings." |
| `HistoryList` drag-and-drop and new route navigation coexist | Low — list view unchanged | No modifications to `HistoryList`. It continues to manage groups via its own inline actions. |

---

## 9. Open Questions

None. All 16 design decisions resolved in the grilling session.

---

*Spec written 2026-08-12. Based on 16-point grilling session over folder-first grid navigation. Builds on the app shell and card system from `improvement-to-uiux` iter-1. Senior code review applied — ownership checks, COALESCE fallback, and error states added.*
