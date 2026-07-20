# Organizations Feature

**Date:** 2026-07-17
**Status:** Draft
**Source:** derived from /grill-me session on 2026-07-17

## Overview

Add an "Organizations" feature to conveneAI that lets registered users create shareable organizations. Each org has a single shared password, named external members (no account required), and selected folders shared read-only. External members get their own per-recording AI chat, persisted across sessions. The org landing page shows aggregated action items grouped by folder — this is the primary view for all org visitors.

## Architecture

Today every table is scoped to a single `user_id` FK. Organizations introduce a **parallel membership** layer: external members exist only within an org and have no user account. Chat messages need to support both `user_id` (owner) and `member_id` (external). API routes get a parallel auth layer (`/api/org/`) separate from the existing user-auth routes.

```
┌─────────────────────────────────────────────────────┐
│                    Main App (existing)               │
│  /api/history  /api/groups  /api/chat/[id]  ...     │
│  Auth: withAuth() → user cookie                     │
│  Scope: user_id                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                    Org View (new)                     │
│  /api/org/[orgId]/folders                            │
│  /api/org/[orgId]/action-items                       │
│  /api/org/[orgId]/recordings/[id]                    │
│  /api/org/[orgId]/chat/[recordingId]                 │
│  /api/org/[orgId]/events  (SSE)                     │
│  Auth: orgSession cookie OR owner user cookie        │
│  Scope: org_folder_links + member_id                 │
└─────────────────────────────────────────────────────┘

URL: /org/[slug] → unifies both entry points:
  - Owner (logged in, from Organizations tab) → skip password, show Manage
  - External (no account) → password gate → name select → org view

**orgId resolution:** The `[slug]` page is server-rendered and resolves slug → orgId from the DB. Client components receive `orgId` as a prop (passed down from the server component). All client-side API calls use `orgId` in the URL path (`/api/org/${orgId}/...`), not the slug. The slug is only used for the initial page route.
```

### System Context

- **Existing, unchanged:** user auth, groups API, recordings API, upload pipeline, S3 storage, Telegram bot, desktop app, nginx, PM2
- **New components:**
  - `organizations`, `org_members`, `org_member_sessions`, `org_folder_links` tables
  - `/api/org/*` API routes (org-scoped, new auth layer)
  - `/org/[slug]` page (password gate + org landing)
  - Organizations tab + management UI in main app
  - Org-level SSE for real-time updates
  - Shared `chat_messages` table extended with `member_id` column
- **Modified:**
  - `chat_messages` table — ADD `member_id` column (nullable FK)
  - `NAV_LINKS` in `user-nav.tsx` — add Organizations tab
  - `lib/db.ts` — new tables in `initSchema()`

## Requirements

### Functional

1. **FR-01:** A registered user can create an organization by providing a name (auto-generates URL slug)
2. **FR-02:** The owner can add their existing groups/folders to the organization (one folder → one org max)
3. **FR-03:** The owner can remove folders from the organization (preserves member chat data)
4. **FR-04:** The owner can add external members by name (no email/account required)
5. **FR-05:** The owner can remove external members (deletes their chat history)
6. **FR-06:** The owner can set/change the organization's shared password
7. **FR-07:** The owner accesses orgs from a new "Organizations" tab in the main app nav
8. **FR-08:** External users visit `/org/<slug>`, enter the org password, select their name from available members, and enter the org
9. **FR-09:** If a member name is already in active use, the UI hides it; server enforces first-come-first-serve with error toast on race condition
10. **FR-10:** Org landing page defaults to action items grouped by folder (each folder → list of its action items across all recordings)
11. **FR-11:** Org has a toggle to switch from action items view to recordings-by-folder view (same expandable folder tree as main app)
12. **FR-12:** External users can click into a recording to see transcript, action items (read-only), and their own AI chat
13. **FR-13:** External users can chat with the AI per recording — chat history persists across sessions, scoped to member+recording
14. **FR-14:** External users cannot edit action items, upload recordings, or modify anything
15. **FR-15:** New recordings added to a shared folder automatically appear in the org via SSE (no refresh)
16. **FR-16:** When the owner removes a member, that member is immediately kicked to the password page via SSE
17. **FR-17:** Org member sessions have a 7-day TTL (cookie-based)
18. **FR-18:** Each action item on the org landing page links to its source recording
19. **FR-19:** The org recording view is identical to the main app recording view minus action item editing
20. **FR-20:** The owner chats as themselves (`user_id`); external members chat as `member_id` — separate threads per recording

### Non-Functional

- **NFR-01:** Existing app routes must continue working without modification — orgs are additive
- **NFR-02:** SSE follows existing `lib/sse.ts` polling pattern; nginx already has `proxy_buffering off` on `/api/queue`, needs same for `/api/org/*/events`
- **NFR-03:** Password hashing uses bcryptjs (same as user passwords)
- **NFR-04:** Org slug must be URL-safe and unique across all orgs
- **NFR-05:** Chat context window: 80K chars from transcript tail (same as existing chatbot)
- **NFR-06:** Sqlite WAL mode handles concurrent member chat writes
- **NFR-07:** No new npm packages required — everything uses existing stack

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `lib/org-auth.ts` | Org session management — create session, validate session, destroy session, cookie config |
| `lib/with-org-auth.ts` | Auth middleware for org API routes — accepts org member session OR owner user cookie |
| `app/org/[slug]/page.tsx` | Server component: check auth → password gate OR org landing |
| `app/org/[slug]/OrgGate.tsx` | Client: password input + member name selector |
| `app/org/[slug]/OrgWorkspace.tsx` | Client: org landing — action items view + recordings view toggle |
| `app/org/[slug]/OrgManagePanel.tsx` | Client: owner-only management (add/remove folders, add/remove members, set password) |
| `app/org/[slug]/recording/[id]/page.tsx` | Server component: org-scoped recording detail |
| `components/org-recording-workspace.tsx` | Client: read-only recording workspace with member-scoped chat |
| `components/organizations-list.tsx` | Client: list of owner's organizations (in main app) |
| `app/api/org/auth/route.ts` | POST: validate org password + claim member → set session cookie |
| `app/api/org/auth/logout/route.ts` | POST: destroy org session |
| `app/api/org/[orgId]/action-items/route.ts` | GET: aggregated action items grouped by folder |
| `app/api/org/[orgId]/folders/route.ts` | GET: list folders + recordings. POST: add folder. DELETE: remove folder |
| `app/api/org/[orgId]/members/route.ts` | GET: list members + active status. POST: add member. DELETE: remove member |
| `app/api/org/[orgId]/settings/route.ts` | PATCH: update org password |
| `app/api/org/[orgId]/recordings/[recordingId]/route.ts` | GET: recording detail (transcript, segments, speakers, action items, hasAudio) |
| `app/api/org/[orgId]/chat/[recordingId]/route.ts` | GET: chat history. POST: send message (member-scoped or owner-scoped) |
| `app/api/org/[orgId]/events/route.ts` | GET: SSE endpoint — recording added, member removed |
| `app/api/org/[orgId]/recordings/[recordingId]/audio/route.ts` | GET: pre-signed S3 audio URL (same as main app) |
| `app/api/organizations/route.ts` | GET: list owner's orgs. POST: create org |
| `app/api/organizations/[id]/route.ts` | DELETE: delete org (cascade: members, sessions, folder links, member chats) |

### Files to Modify

| File | Change |
|------|--------|
| `lib/db.ts` | Add new tables (`organizations`, `org_members`, `org_member_sessions`, `org_folder_links`) to `initSchema()`. Add `member_id` column to `chat_messages` via migration. Add relevant indexes. |
| `components/user-nav.tsx` | Add `{ href: "/organizations", label: "Organizations", icon: Building2 }` to `NAV_LINKS` |
| `app/page.tsx` | (No change needed — just ensure org tab doesn't break existing layout) |
| `CLAUDE.md` | Update database schema section, add org architecture section |
| `infra/nginx-asisvoz.conf` | Add `proxy_buffering off` on `/conveneai/api/org/` SSE location (confirm existing `/api/queue` pattern) |

### Step-by-Step

1. **Database schema migration** — Add `organizations`, `org_members`, `org_member_sessions`, `org_folder_links` tables. Add `member_id` column to `chat_messages`. Add all indexes. Write migration in `lib/db.ts` `initSchema()` following existing pattern (column existence checks, additive-only).

   **⚠️ Ordering constraint:** `org_members` table MUST be created BEFORE the `chat_messages` table rebuild, because the rebuild adds `member_id TEXT REFERENCES org_members(id)`. Order in `initSchema()`:
   1. `organizations` table
   2. `org_members` table
   3. `org_member_sessions` table
   4. `org_folder_links` table
   5. THEN `chat_messages` rebuild (checked via `!hasColumn(db, 'chat_messages', 'member_id')`)
   6. New indexes

   The rebuild must be wrapped in a transaction with `foreign_keys = OFF` during the operation (following existing `migrateV1Tables` pattern). All existing `chat_messages` rows get `member_id = NULL`.

2. **Org auth library** — `lib/org-auth.ts`: `createOrgSession(memberId)`, `validateOrgSession(token)`, `destroyOrgSession(token)`. Cookie: `conveneai-org-auth`, httpOnly, sameSite=lax, 7-day TTL. `lib/with-org-auth.ts`: middleware that extracts `orgId` from route params, then checks (a) org session cookie → member context (with org validation), OR (b) user auth cookie → looks up org by id, verifies `org.user_id === user.userId` → owner context. Returns 401 if neither. Pattern follows existing `withAuth` which receives `{ params }` from route context.

3. **Organizations CRUD API** — `POST /api/organizations` (create: name → slug, password_hash). `GET /api/organizations` (list owner's orgs with member/folder counts). `DELETE /api/organizations/[id]` (delete org — cascades to members, sessions, folder links, member chat messages; owner only). Slug generation: slugify name, check uniqueness, append `-2`, `-3` etc. on conflict.

4. **Organizations tab in main app** — Add `Building2` icon link to `NAV_LINKS`. Create `app/organizations/page.tsx` (list owner's orgs, "Create Organization" button). Create `components/organizations-list.tsx`.

5. **Org password gate page** — `app/org/[slug]/page.tsx` server component: load org by slug, check auth, render `OrgGate` or `OrgWorkspace`. `OrgGate.tsx`: password input → POST `/api/org/auth` → if success, show member name selector → POST claim → set cookie → enter workspace. Handle: wrong password (error message), name already taken (toast + refresh member list), **no members configured** (show message: "This organization hasn't added any members yet. Ask the owner to add you." — don't proceed to member selection).

6. **Org auth API routes** — `POST /api/org/auth` (validate password, return member list with active status). `POST /api/org/auth` with `claimMember` flag (atomically claim member name, create session, set cookie). `POST /api/org/auth/logout` (destroy session).

7. **Org folders API** — `GET /api/org/[orgId]/folders` (list shared folders with recordings, verify access). `POST /api/org/[orgId]/folders` (owner only: add folder by group_id, validate: folder belongs to owner, folder not already shared to another org, folder exists). `DELETE /api/org/[orgId]/folders` (owner only: remove folder link, preserve chat data).

8. **Org action items API** — `GET /api/org/[orgId]/action-items` (for all shared folders: join recordings, parse `action_items_json`, group by folder, return flat list per folder with recording link).

9. **Org landing workspace** — `OrgWorkspace.tsx`: shows action items by default (grouped by folder). Tab toggle to switch to recordings view (reuse folder-tree pattern from `history-list.tsx` but read-only — no drag, no rename, no delete). Each recording links to `/org/[slug]/recording/[id]`.

10. **Org recording detail** — `app/org/[slug]/recording/[id]/page.tsx`: verify org access, load recording detail. `org-recording-workspace.tsx`: same layout as `recording-workspace.tsx` (chat tab + transcript tab + action items sidebar) but (a) `ActionItemsSidebar` receives `recordingId={undefined}` → renders in read-only mode (already supported — the component checks `editable = Boolean(recordingId)`), (b) chat uses org-scoped API.

11. **Org chat API** — `GET/POST /api/org/[orgId]/chat/[recordingId]`: verify org access to recording via folder link. GET returns chat history filtered by member_id (or user_id for owner). POST saves with member_id (external) or user_id (owner). Reuses `chatAboutMeeting()` from `lib/chatbot.ts` (no changes needed — it takes transcript + history, returns reply).

12. **Org member management API** — `GET /api/org/[orgId]/members` (list members + active session indicator). `POST /api/org/[orgId]/members` (owner only: add member by name). `DELETE /api/org/[orgId]/members` (owner only: delete member + all their chat messages in org recordings + destroy their session if active).

13. **Org settings API** — `PATCH /api/org/[orgId]/settings` (owner only: update password).

14. **Org SSE events** — `GET /api/org/[orgId]/events`: use existing `sseResponse()` from `lib/sse.ts`. The `snapshot()` function returns the current state of all shared folders' recordings plus the member list. When the serialized snapshot changes, all connected clients receive an update. Clients compare the delta against their current state: (a) new recordings appear → refresh folder list, (b) current member_id no longer in member list → redirect to password gate + toast. This covers both recording additions AND deletions (a deleted recording disappears from the snapshot).

15. **Owner management panel** — `OrgManagePanel.tsx`: shown in org workspace when viewer is the owner. Sections: "Folders" (multi-select from owner's unshared groups, remove shared folders), "Members" (add name input, member list with remove button), "Settings" (change password). Folds into the org workspace as a collapsible panel or dialog.

16. **nginx config** — Ensure `/conveneai/api/org/` locations have `proxy_buffering off` for SSE. Update `infra/nginx-asisvoz.conf` and the live server config.

17. **CLAUDE.md update** — Document new tables, org architecture, and downstream impact (org routes affect desktop app? No — org routes are web-only for v1).

## API Design

### `POST /api/organizations`
- **Purpose:** Create a new organization
- **Auth:** User cookie (withAuth)
- **Request:** `{ name: string, password: string }`
- **Response 201:** `{ id, name, slug, createdAt }`
- **Errors:** 400 (missing name/password), 409 (slug conflict — retry with suffixed slug)

### `GET /api/organizations`
- **Purpose:** List organizations owned by current user
- **Auth:** User cookie
- **Response:** `{ organizations: [{ id, name, slug, memberCount, folderCount, createdAt }] }`

### `DELETE /api/organizations/[id]`
- **Purpose:** Delete an organization and all related data (owner only)
- **Auth:** User cookie (withAuth) — must be the org owner
- **Response:** `{ deleted: true }`
- **Cascade behavior:** Deletes all org_members, org_member_sessions, org_folder_links, and all chat_messages where member_id references an org member. The owner's groups and recordings are NOT affected.
- **Errors:** 403 (not owner), 404 (not found)

### `POST /api/org/auth`
- **Purpose:** Validate org password and/or claim member identity
- **Auth:** None (public)
- **Request:** `{ slug, password?, claimMemberId? }`
- **Response 200 (password check):** `{ ok: true, members: [{ id, name, active: boolean }] }`
- **Response 200 (claim member):** `{ ok: true, member: { id, name }, token }` — sets `conveneai-org-auth` cookie
- **Errors:** 401 (wrong password), 404 (org not found), 409 (member already claimed)

### `POST /api/org/auth/logout`
- **Purpose:** Destroy org session
- **Auth:** Org session cookie
- **Response:** `{ ok: true }`

### `GET /api/org/[orgId]/action-items`
- **Purpose:** Aggregated action items across all shared folders
- **Auth:** Org session OR owner user cookie
- **Response:** `{ folders: [{ folderId, folderName, items: [{ task, assignee, deadline, context, recordingId, recordingFilename }] }] }`

### `GET /api/org/[orgId]/folders`
- **Purpose:** List shared folders with their recordings
- **Auth:** Org session OR owner user cookie
- **Response:** `{ folders: [{ id, name, recordings: [{ id, filename, durationSeconds, speakerCount, actionItemCount, createdAt }] }] }`

### `POST /api/org/[orgId]/folders`
- **Purpose:** Add a folder to the org (owner only)
- **Auth:** Owner user cookie
- **Request:** `{ groupId: string }`
- **Response 201:** `{ folderId, folderName }`
- **Errors:** 400 (missing groupId), 403 (not owner), 404 (group not found), 409 (group already shared)

### `DELETE /api/org/[orgId]/folders`
- **Purpose:** Remove a folder from the org (owner only)
- **Auth:** Owner user cookie
- **Request:** query `?groupId=X`
- **Response:** `{ removed: true }`

### `GET /api/org/[orgId]/members`
- **Purpose:** List members with active status
- **Auth:** Org session OR owner user cookie
- **Response:** `{ members: [{ id, name, active: boolean }] }`

### `POST /api/org/[orgId]/members`
- **Purpose:** Add a member (owner only)
- **Auth:** Owner user cookie
- **Request:** `{ name: string }`
- **Response 201:** `{ id, name }`
- **Errors:** 400 (empty name), 403 (not owner)

### `DELETE /api/org/[orgId]/members`
- **Purpose:** Remove a member — deletes all their chat messages + active session (owner only)
- **Auth:** Owner user cookie
- **Request:** query `?memberId=X`
- **Response:** `{ removed: true, deletedChatCount: number }`

### `PATCH /api/org/[orgId]/settings`
- **Purpose:** Update org password (owner only)
- **Auth:** Owner user cookie
- **Request:** `{ password: string }`
- **Response:** `{ ok: true }`

### `GET /api/org/[orgId]/recordings/[recordingId]`
- **Purpose:** Recording detail (transcript, segments, speakers, action items)
- **Auth:** Org session OR owner user cookie
- **Response:** `{ id, filename, source, durationSeconds, speakerCount, fullTranscript, segments, speakers: [{id, name}], actionItems, hasAudio, groupId, groupName, createdAt }`
- **Errors:** 404 (not in org or not found)

### `GET /api/org/[orgId]/recordings/[recordingId]/audio`
- **Purpose:** Pre-signed S3 URL for audio playback
- **Auth:** Org session OR owner user cookie
- **Response:** `{ url: string }`

### `GET /api/org/[orgId]/chat/[recordingId]`
- **Purpose:** Chat history for this recording
- **Auth:** Org session OR owner user cookie
- **Response:** `{ messages: [{ id, role, content, createdAt }] }`
- Scope: external members see their own messages (filtered by `member_id`); owner sees their own (filtered by `user_id`, `member_id IS NULL`)

### `POST /api/org/[orgId]/chat/[recordingId]`
- **Purpose:** Send a message to the AI about this recording
- **Auth:** Org session OR owner user cookie
- **Request:** `{ message: string }`
- **Response:** `{ reply: string, messageId: string }`
- Saves user message + assistant reply with `member_id` (external) or `user_id` (owner)

### `GET /api/org/[orgId]/events`
- **Purpose:** SSE stream for real-time updates
- **Auth:** Org session OR owner user cookie
- **Mechanism:** Uses existing `sseResponse()` polling pattern. The snapshot function returns `{ folders: [{ id, recordingIds: [...] }], memberIds: [...] }`. When the serialized snapshot changes, all clients receive a `data:` event with the full snapshot. Clients diff against their local state to detect changes.
- **Detected changes:**
  - Recording added to or removed from a shared folder → folder's `recordingIds` list changed
  - Member removed → `memberIds` no longer include the current member → kick to password gate
- **Heartbeat:** `: keep-alive` comment every 2s when no changes

## Data Model

### New Table: `organizations`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | TEXT PK | yes | UUID |
| user_id | TEXT FK→users | yes | Owner (CASCADE on delete) |
| name | TEXT | yes | Display name |
| slug | TEXT UNIQUE | yes | URL-safe, auto-generated from name |
| password_hash | TEXT | yes | bcryptjs hash of shared org password |
| created_at | TEXT | yes | datetime('now') |

### New Table: `org_members`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | TEXT PK | yes | UUID |
| organization_id | TEXT FK→organizations | yes | CASCADE on delete |
| name | TEXT | yes | Display name assigned by owner |
| created_at | TEXT | yes | datetime('now') |

### New Table: `org_member_sessions`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | TEXT PK | yes | UUID |
| member_id | TEXT FK→org_members | yes | CASCADE on delete |
| token | TEXT UNIQUE | yes | Random 32-byte hex |
| created_at | TEXT | yes | datetime('now') |
| expires_at | TEXT | yes | 7 days from creation |

### New Table: `org_folder_links`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| organization_id | TEXT FK→organizations | yes | CASCADE on delete |
| group_id | TEXT FK→groups | yes | UNIQUE (one folder → one org max) |
| created_at | TEXT | yes | datetime('now') |
| **PK:** | (organization_id, group_id) | — | Composite primary key |

### Modified Table: `chat_messages`
| Field | Change | Description |
|-------|--------|-------------|
| member_id | ADD (nullable) | FK→org_members ON DELETE CASCADE. NULL for owner/user messages. |
| user_id | Modify | Change to nullable — NULL when message is from an org member. |

**Migration approach:** Since SQLite doesn't support ALTER COLUMN to make `user_id` nullable, we'll add `member_id` column and make `user_id` accept NULL values. Actually, `user_id` in SQLite is already implicitly nullable unless declared `NOT NULL`. The existing table has `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`. To relax this, we'd need to rebuild the table. Approach:

1. `ALTER TABLE chat_messages ADD COLUMN member_id TEXT REFERENCES org_members(id) ON DELETE CASCADE`
2. For v1, we keep `user_id NOT NULL` and set it to the owner's ID for org chat messages too — OR we rebuild the table. Given the existing pattern in `lib/db.ts` (recordings v1→v2 rebuild), we should rebuild `chat_messages`:

```sql
ALTER TABLE chat_messages RENAME TO chat_messages_old;
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,  -- nullable now
  member_id TEXT REFERENCES org_members(id) ON DELETE CASCADE,  -- nullable
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO chat_messages SELECT id, recording_id, user_id, NULL, role, content, created_at FROM chat_messages_old;
DROP TABLE chat_messages_old;
CREATE INDEX IF NOT EXISTS idx_chat_messages_recording ON chat_messages(recording_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_member ON chat_messages(member_id);
```

### New Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON organizations(user_id);
CREATE INDEX IF NOT EXISTS idx_orgs_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_sessions_token ON org_member_sessions(token);
CREATE INDEX IF NOT EXISTS idx_org_sessions_member ON org_member_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_org_folder_links_org ON org_folder_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_folder_links_group ON org_folder_links(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_member ON chat_messages(member_id);
```

## Frontend Changes

### Component Tree (Org Side)

```
app/org/[slug]/page.tsx (server)
├── OrgGate.tsx (when no auth)
│   ├── Password input → POST /api/org/auth
│   └── Member name selector → POST /api/org/auth (claimMemberId)
└── OrgWorkspace.tsx (when authenticated)
    ├── OrgManagePanel.tsx (owner only — collapsible/dialog)
    │   ├── Folder selector (multi-select from unshared groups)
    │   ├── Member list (+ add input, remove button)
    │   └── Change password form
    ├── View toggle: Action Items | Recordings
    ├── Action Items View (default)
    │   └── Per-folder sections with action item cards
    └── Recordings View
        └── Read-only folder tree (expandable, recordings are links)

app/org/[slug]/recording/[id]/page.tsx (server)
└── OrgRecordingWorkspace.tsx (client)
    ├── Header: filename, metadata, back button (→ org)
    ├── Audio player
    ├── Tab: Chat | Transcript
    ├── ChatWindow (uses org chat API)
    ├── TranscriptPanel (read-only)
    └── ActionItemsSidebar (recordingId=undefined → read-only)
```

### Component Tree (Main App Side)

```
app/organizations/page.tsx (server)
└── OrganizationsList.tsx (client)
    ├── Organization cards (name, slug, member/folder counts)
    ├── "Create Organization" button → dialog
    └── Click card → /org/[slug] (owner entry)

NAV_LINKS in user-nav.tsx:
  + { href: "/organizations", label: "Organizations", icon: Building2 }
```

### New/Modified State & Props

- **OrgGate:** `orgSlug`, `password`, `error`, `members` list, `selectedMemberId`, `claiming` (loading)
- **OrgWorkspace:** receives `orgId`, `org` (name, slug), `isOwner` from server component. State: `viewMode` ("actions" | "recordings"), `actionItems` (grouped by folder), `recordings` (by folder), SSE connection
- **OrgManagePanel:** `folders` (available + shared), `members`, `password` draft. Owner-only visibility.
- **OrgRecordingWorkspace:** Same shape as `RecordingWorkspace`, but `detail` fetched from org API, `recordingId={undefined}` passed to `ActionItemsSidebar` for read-only mode. Chat uses `/api/org/[orgId]/chat/[recordingId]`.

### SSE Event Contract

Client-side in `OrgWorkspace`:
```typescript
const events = new EventSource(api(`/api/org/${orgId}/events?memberId=${currentMemberId}`));
events.onmessage = (e) => {
  const snapshot = JSON.parse(e.data);
  const folderMap = new Map(snapshot.folders.map(f => [f.id, f.recordingIds]));
  // Detect recording changes by comparing folder recording counts/ids
  const changed = /* diff against current state */;
  if (changed) refreshFolderList();
  // Detect if current member was removed
  if (!snapshot.memberIds.includes(currentMemberId)) {
    events.close();
    // Clear org cookie, redirect to password gate, show toast
  }
};
```

Note: `memberId` is passed as query param so the SSE route can include it in the member list check. For the owner viewing the org, `memberId` is omitted (or set to `"owner"`) and the member removal check is skipped.

## Testing Strategy

### Unit Tests (Vitest)

1. **Org auth:** `createOrgSession` / `validateOrgSession` / `destroyOrgSession` — happy path, expired token, invalid token
2. **Slug generation:** uniqueness enforcement, conflict suffix appending
3. **Org CRUD API:** create with valid/invalid input, list filters by owner, slug conflict
4. **Org auth API:** password validation (correct/wrong), member claiming (available/already-claimed/race condition), session cookie set
5. **Org folders API:** add folder (valid/invalid group, already-shared), remove folder, access verification
6. **Org action items API:** aggregation across recordings, grouping by folder, empty folders, malformed action_items_json
7. **Org chat API:** member-scoped history isolation, owner vs member messages, chat save with correct identity column
8. **Org members API:** add/remove, delete chat cascade on member removal, active session detection
9. **`chatAboutMeeting` reuse:** verify it works with member-scoped history (should — it takes arbitrary history array)

### Browser Tests (Playwright)

1. **Create org flow:** log in → Organizations tab → create org → verify appears in list
2. **External user flow:** visit `/org/[slug]` → wrong password (error) → correct password → select name → see action items
3. **Member name race condition:** two tabs open, both select same name — second gets error toast
4. **Action items landing page:** verify items grouped by folder, click item links to recording
5. **Recording detail (org):** verify transcript visible, action items read-only (no edit/delete buttons), chat works
6. **Chat persistence:** close tab, reopen link, re-authenticate, verify chat history still there
7. **Owner management:** add folder → appears in org, remove folder → disappears, add member → appears in selector
8. **SSE new recording:** open org as member, owner adds recording to shared folder → appears without refresh
9. **SSE member removal:** open org as member, owner removes member → kicked to password page with toast
10. **nginx SSE:** verify EventSource connects and receives events (confirm `proxy_buffering off` works)

### Manual Verification

1. Deploy to production (rsync + build + pm2 restart)
2. Update nginx config for `/conveneai/api/org/` SSE location
3. Verify existing app (recordings, upload, queue, settings, login, chat) works unchanged
4. Test owner flow: create org → add folders/members → view org
5. Test external flow: share link → password → name → action items → recording + chat
6. Verify real-time: have two browser windows open (one as external member, one as owner) and test recording addition + member removal

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `chat_messages` table rebuild corrupts existing chat data | High — loss of all chat history | Wrap rebuild in transaction; test on copy of prod DB first; existing v1→v2 migration pattern in `lib/db.ts` proves the approach works |
| SSE connection leaks for many concurrent org viewers | Medium | Existing SSE pattern is polling-based (not persistent per-connection state); each connection is a simple setInterval. For v1 with limited org members, this is fine. Add connection limit if needed later. |
| nginx needs `proxy_buffering off` on org SSE routes | Medium — SSE silently breaks | Document in CLAUDE.md; test during deploy; follow existing `/api/queue` pattern |
| One folder → one org constraint complicates owner workflow | Low | Clear error message when folder is already shared. Owner can duplicate folder content manually if needed. |
| Shared password compromises org if leaked | Medium | Password change is one button away. Document that owner should rotate if leaked. Future: add password reset audit log. |
| Brute-force on org password gate | Low | bcryptjs verification is slow (~12 rounds), making brute-force impractical. No rate limiting in v1 — the `/api/org/auth` endpoint is public. Future: add IP-based rate limiting if needed. |
| Race condition in member claiming | Low | `POST /api/org/auth` with `claimMemberId`: use a transaction with `SELECT … FOR UPDATE`-equivalent locking (SQLite serializes writes via WAL, so a `SELECT` + conditional `INSERT` in a transaction is safe). The optimistic UI hide is a best-effort enhancement; the server is authoritative. |
| `chat_messages.user_id` relaxation could break existing chat queries | Medium | Audit all queries touching `chat_messages` — currently only in `chat/[recordingId]/route.ts`. The org chat route is separate (`/api/org/.../chat`). Add tests to verify existing chat API still works after migration. |

## Open Questions

None — all decisions resolved during grilling session.

## Not in v1

- Account-holding users as org members (registered user accounts joining others' orgs)
- Action item deduplication across recordings
- Owner chatting as a member
- Adding/uploading recordings from within the org
- Cross-org operations (moving resources between orgs)
- Org-level analytics or usage tracking
- Email invitations (owner distributes link manually)
- Role-based access control within org (just owner + members)
- Multiple passwords per org
