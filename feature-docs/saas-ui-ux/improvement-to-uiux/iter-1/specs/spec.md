# Spec: UI/UX Overhaul — OpenAI Platform-Inspired App Shell

**Feature:** saas-ui-ux
**Implementation:** improvement-to-uiux
**Iteration:** 1
**Status:** ready-for-implementation
**Reference:** [OpenAI Platform Chat Prompts](../../shared/references/ui-description-openai-platform-chat-prompts.md)

---

## Overview

Redesign the Convene AI UI to follow the calm, low-density, sidebar-driven pattern from the OpenAI Platform "Chat Prompts" screen. This is a directional adaptation — 6 design principles carried forward, OpenAI-specific details discarded.

**Six principles from the reference:**

1. Calm, low-density layout — generous spacing, off-white background, white surfaces
2. Black as primary action color — no brand accent competing with CTAs
3. Sidebar-driven navigation — grouped items, outline icons, neutral active-state pill
4. Dual-path creation — manual path + AI-assisted path (Generate deferred to iter-2)
5. Creation module adapts to user maturity — prominent for new users, compact for power users
6. Card grid as primary content view — with list toggle for power users

---

## 1. Visual System: CSS Token Changes

### 1.1 Background

Change `--background` from pure white to off-white warm gray:

```css
:root {
  --background: 40 6% 97%;  /* was 0 0% 100% → now ≈#F9F9F8 */
  /* ... all other tokens unchanged */
}
```

Cards, popovers, sidebar, and dialogs remain `--card: 0 0% 100%` (pure white). This creates natural depth — white surfaces float on the warm-gray page.

### 1.2 Primary action color

Already near-black in the current theme (`--primary: 0 0% 9%`). No change needed. The existing shadcn defaults already use black-leaning primary. Confirm all `variant="default"` buttons render as black-fill/white-text.

### 1.3 Accent usage

The existing `--accent` token (`0 0% 96.1%`, ≈ light gray) stays as-is for secondary surfaces. Blue only appears on:
- Category icon badges on recording cards (source indicator)
- Links (browser default or `.text-primary` underline)
- Chart colors (untouched)

### 1.4 Border radius

No change. shadcn/ui's default `--radius: 0.5rem` already produces the pill/rounded-rect shape language described in the reference.

### 1.5 Dark theme

The `.dark` block in `globals.css` is preserved but not wired to a theme toggle. Continue serving `colorScheme: "light"` via the viewport export. Dark tokens are left in place as dead code — remove them only if they cause confusion.

### Files changed

- `app/globals.css` — one line: `--background: 40 6% 97%;`

---

## 2. App Shell: Persistent Sidebar + Top Bar

### 2.1 Layout structure

Replace the current per-page `AppHeader` pattern with a persistent app shell in the root layout:

```
┌──────────────────────────────────────────────────────┐
│ Top Bar (org switcher, global nav, user avatar)      │
├──────────────┬───────────────────────────────────────┤
│ Sidebar      │ Main Content (scrollable)             │
│ (fixed,      │                                       │
│  280px)      │  - Page header                        │
│              │  - Creation module (progressive)       │
│  Create      │  - Card grid / list view              │
│  Workspace   │  - Or recording workspace (3-panel)    │
│  Settings    │                                       │
│              │                                       │
└──────────────┴───────────────────────────────────────┘
```

### 2.2 Implementation

Create `components/app-shell.tsx` (client component):

```tsx
// Wraps children in sidebar + top bar
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopBar />
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
```

Update `app/layout.tsx` to wrap `{children}` in `<AppShell>`. The shell does NOT render on `/login` or `/register` — detect via `usePathname()` and skip the shell for auth pages.

### 2.3 What happens to existing AppHeader?

`components/app-header.tsx` is **removed**. The `<h1>` and subtitle move to the top bar (Q3). The `UserNav` is absorbed into the top bar's right-side cluster.

### Files changed

- `components/app-shell.tsx` — new
- `components/app-sidebar.tsx` — new
- `components/app-topbar.tsx` — new
- `app/layout.tsx` — wrap children in AppShell (conditional on pathname)
- `components/app-header.tsx` — deleted
- `app/page.tsx` — remove `<AppHeader>`, page content simplifies
- `app/upload/page.tsx` — remove any standalone header
- `app/queue/page.tsx` — remove any standalone header
- `app/settings/page.tsx` — remove any standalone header
- `app/recording/[id]/page.tsx` — remove standalone header
- `app/org/[slug]/page.tsx` — remove standalone header (org workspace lives inside shell)

---

## 3. Sidebar

### 3.1 Visual design

- Fixed position, 280px wide, full height below top bar
- White background (`bg-card`), 1px right border (`border-r border-border`)
- Three labeled sections with uppercase gray section headers (`text-xs text-muted-foreground tracking-wider px-4 pt-6 pb-2`)

### 3.2 Navigation tree

| Section | Items |
|---|---|
| **Create** | New Recording (+), New Chat (MessageSquare) |
| **Workspace** | All Recordings (Home), Action Items (ListTodo), Queue (ListChecks) |
| **Settings** | Account (Settings), API Keys (Key), Organizations (Building2) |

Each item:
- 36px row height, `mx-2`, `rounded-lg`
- 18px outline icon + label, `gap-3`, `px-3`
- Active state: `bg-muted` (neutral gray pill, no accent color)
- Inactive: transparent, hover → `bg-muted/50`

### 3.3 Behavior

- "New Recording" triggers file picker (same logic as current Upload button, but opens a file input dialog inline — does NOT navigate to `/upload`)
- "New Chat" opens a dropdown/popover listing recent recordings — user picks one and navigates to its workspace with chat tab active
- Navigation items use `next/link` with `usePathname()` for active detection
- Sidebar bottom: collapse toggle icon (cosmetic for iter-1 — does nothing functional, placeholder for future collapsible sidebar). If not time, omit.

### 3.4 What happens to existing UserNav?

`components/user-nav.tsx` is **removed**. Its links move to the sidebar. The logout action moves to the top bar user avatar dropdown.

### Files changed

- `components/app-sidebar.tsx` — new
- `components/user-nav.tsx` — deleted

---

## 4. Top Bar

### 4.1 Visual design

- Fixed position, full width, height ~52px
- Off-white background matching page (`bg-background`, not white — same as page)
- No bottom border (matches reference)
- `px-6`, `flex items-center justify-between`

### 4.2 Left side: org switcher + app name

```
[Building2 icon] Personal / [Org Name]  [ChevronDown]    conveneAI
```

- If user is in an org context (pathname starts with `/org/[slug]`): show org name with dropdown chevron. Dropdown lists "Personal" + all user's orgs.
- If user is in personal context: show "Personal" with dropdown chevron. Dropdown lists all user's orgs.
- "conveneAI" is a lighter-weight text label (not bold, `text-muted-foreground`), serves as implicit home link.
- The dropdown is a single level — no "project" sub-level (unlike OpenAI's two-level switcher).

### 4.3 Right side: user avatar

- Circular avatar with first letter of email (like current UserNav but simplified)
- Click opens dropdown: email address (non-interactive), "Log out" button
- The avatar replaces the email text + logout button in the current UserNav

### 4.4 What's NOT in the top bar

- No "Dashboard" / "API Docs" text links (OpenAI-specific)
- No settings gear icon (that's in the sidebar)
- No "Back to Catalog" link (that was a placeholder from the old single-page layout)

### Files changed

- `components/app-topbar.tsx` — new

---

## 5. Main Content: Home Page (Recording List)

### 5.1 Page structure

```
┌────────────────────────────────────────────┐
│ [Creation module — progressive]            │
│                                            │
│ Your Recordings          [🔍 Search...] [≡]│
│                                            │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │ Card 1   │ │ Card 2   │ │ Card 3   │    │
│ └──────────┘ └──────────┘ └──────────┘    │
│                                            │
│ (empty grid cells or list rows below)      │
└────────────────────────────────────────────┘
```

### 5.2 Creation module: progressive disclosure

**Rule:** Based on `recordingCount` (fetched from `/api/history`):

| Recordings | Behavior |
|---|---|
| 0 | Full hero: centered "Create a recording" headline + Upload button (black, pill, `+` icon) + "Upload an audio recording to get started" subtext. No "Your Recordings" section. |
| 1–3 | Centered creation module (headline + Upload button), "Your Recordings" section below with card grid |
| 4+ | Compact action bar: horizontal row above "Your Recordings" — "Upload recording" button (still black/pill but smaller) on the left. No headline, no centered layout. |

The "Generate…" / "Describe your meeting…" input is **out of scope for iter-1**. A placeholder comment in the code marks where it will be added in iter-2. The Upload button is the sole creation path in iter-1.

### 5.3 Upload button behavior

Clicking "New Recording" (sidebar) or "Upload recording" triggers a file input (`<input type="file" accept="audio/*,video/*">`). On file selection, upload to `/api/upload` with progress indicator (reuse existing upload logic from `upload-zone.tsx` or navigate to `/upload`). If the existing `/upload` page is kept, the button navigates there. **Decision:** keep the existing `/upload` page for iter-1 and have the button navigate to it — this avoids duplicating upload logic. In iter-2, consider inlining upload into the main page.

### 5.4 "Your Recordings" section header

- Section label: "Your Recordings" — `text-lg font-semibold`, left-aligned
- Search input: right-aligned in the header row, pill-shaped, `w-64`, placeholder "Search recordings…"
- View toggle: icon buttons (Grid / List) to the right of search
- Folder filter: optional dropdown to filter by folder (reuse `FolderCombobox` logic)
- The search filters the visible cards/list client-side (or server-side if already fetched).

### Files changed

- `app/page.tsx` — restructured: no AppHeader, creation module + record list inside AppShell
- `components/history-list.tsx` — refactored: card grid view extracted, list view preserved behind toggle
- `components/recording-card.tsx` — new: single card component
- `components/recording-card-grid.tsx` — new: grid layout for cards
- `components/creation-module.tsx` — new: progressive creation hero/bar

---

## 6. Recording Card Design

### 6.1 Card layout

```
┌─────────────────────────────┐
│ [source icon badge]    [⋯]  │
│                             │
│ Meeting Name                │
│                             │
│ ⏱ 23:14    Aug 12, 2025    │
└─────────────────────────────┘
```

- White background, `border border-border`, `rounded-xl`
- Fixed width in grid: ~280px, responsive grid: `grid-cols-[repeat(auto-fill,minmax(280px,1fr))]`
- Padding: `p-4`, gap between cards: `gap-4`

### 6.2 Card contents

| Element | Position | Detail |
|---|---|---|
| Source icon | Top-left | Colored rounded-square: 🖥 desktop (blue), 📱 telegram (cyan), 🌐 web (gray). 32px, `rounded-lg`, with 16px glyph inside. Matches reference's blue chat-bubble badges. |
| More menu | Top-right | "…" button, `variant="ghost" size="icon"`, always visible (not hover-only). Dropdown: Rename, Move to folder, Delete, Download. |
| Filename | Below icon, left-aligned | `font-medium`, one line, truncate. User-editable name (the renamed name, not the original file name). |
| Metadata | Bottom row | Duration (left, `text-sm text-muted-foreground` + Clock icon) + created-at date (right, `text-sm text-muted-foreground`) |

### 6.3 Status indicators

Recording cards show job status:

| Status | Visual |
|---|---|
| **Done** (job complete) | No pill — this is the default, calm state |
| **Processing** (queued/in-progress) | Amber pill: "Processing…" with subtle pulse animation. Card still clickable (shows partial results) |
| **Error** (job failed) | Red pill: "Failed" — card clickable, opens workspace with error details + retry |

Status pill position: between the source icon and the "…" menu, horizontally centered in the top row. Use a small `Badge` variant.

### 6.4 Card interaction

- Entire card is a click target → navigates to `/recording/[id]`
- The "…" menu stops propagation (doesn't trigger navigation)
- Hover: subtle shadow appears (`hover:shadow-sm transition-shadow`)

### 6.5 What's NOT on the card

These fields are NOT on the card (available only in the recording workspace):
- Speaker count
- Action item count
- Folder assignment (visible via filter in section header, not per-card)
- Full transcript preview

### Files changed

- `components/recording-card.tsx` — new
- `components/recording-card-grid.tsx` — new

---

## 7. List View (Toggle)

### 7.1 When visible

User toggles from grid → list via the icon buttons in the section header. Preference is NOT persisted in iter-1 (local state only, resets on navigation). Persist to `user_settings` or `localStorage` in iter-2.

### 7.2 List design

Reuse the existing `history-list.tsx` group-based layout but simplified:
- Remove inline rename (move to "…" menu → dialog)
- Remove folder combobox per-row (move to "…" menu)
- Keep: folder grouping headers, drag-and-drop between groups, sort dropdown
- Keep: search filtering

The existing ~800-line `history-list.tsx` is **refactored**, not rewritten. Extract shared logic (data fetching, search, sort, folder management) into a hook (`use-recordings.ts`). The grid view and list view both consume the same hook.

### Files changed

- `components/history-list.tsx` — refactored, simplified
- `hooks/use-recordings.ts` — new: shared data + state hook

---

## 8. Empty State (0 Recordings)

### 8.1 Visual

Centered in the main content area:

```
┌──────────────────────────────────────┐
│                                      │
│        Create a recording            │  ← text-2xl font-bold, centered
│                                      │
│     [＋ Upload recording]            │  ← black pill button, centered
│                                      │
│   Upload an audio recording or       │  ← text-sm text-muted-foreground
│   describe a meeting to get started. │
│                                      │
└──────────────────────────────────────┘
```

No "Your Recordings" section header. No card grid. No sad-face illustration — the creation module IS the empty state.

### 8.2 Logic

```tsx
if (recordings.length === 0) {
  return <EmptyState />;
}
return (
  <>
    <CreationModule count={recordings.length} />
    <SectionHeader ... />
    {view === "grid" ? <CardGrid /> : <ListView />}
  </>
);
```

---

## 9. Recording Workspace Inside Shell

### 9.1 Current state

- `recording-workspace.tsx` is a client component with its own header (back link, filename, metadata badges)
- Three-tab layout: Chat / Transcript + Action Items sidebar
- `org-recording-workspace.tsx` wraps it for org context

### 9.2 New state

The workspace renders inside the AppShell's main content area. The sidebar and top bar persist.

Changes to `recording-workspace.tsx`:
- Remove the back-link `<Link href="/">` — the sidebar provides navigation
- Remove the standalone `<h1>` filename header — the top bar could show context, or keep a smaller breadcrumb-style header in the content area: `All Recordings > [filename]`
- The three-panel layout remains: transcript panel + chat window + action items sidebar
- The tab switcher (Chat / Transcript) remains

### 9.3 Org workspace

`org-workspace.tsx` currently has its own shell-like header (org name, back link, settings button) and a kanban-style layout with collapsed sections for Recordings, Action Items, and Recent Chats.

Changes:
- The org workspace renders inside AppShell (the sidebar shows, top bar shows org context)
- The org-kanban layout remains but loses its standalone header
- Org-specific navigation: sidebar items may change context (e.g., "All Recordings" → filtered to current org)

### Files changed

- `components/recording-workspace.tsx` — remove standalone header
- `components/org-recording-workspace.tsx` — remove standalone header
- `components/org-workspace.tsx` — remove standalone header, keep kanban content

---

## 10. Removed / Deleted

| File | Action |
|---|---|
| `components/app-header.tsx` | Deleted — replaced by AppShell + AppTopBar |
| `components/user-nav.tsx` | Deleted — links move to sidebar, logout moves to top bar |

---

## 11. New Files Summary

| File | Purpose |
|---|---|
| `components/app-shell.tsx` | Shell wrapper: sidebar + top bar + main slot |
| `components/app-sidebar.tsx` | Fixed sidebar with grouped navigation |
| `components/app-topbar.tsx` | Fixed top bar: org switcher + user avatar |
| `components/recording-card.tsx` | Single recording card |
| `components/recording-card-grid.tsx` | Responsive card grid |
| `components/creation-module.tsx` | Progressive creation UI (hero / compact bar / hidden) |
| `hooks/use-recordings.ts` | Shared data fetching + state for grid and list |

---

## 12. Out of Scope (Iter-2+)

| Item | Reason |
|---|---|
| "Describe your meeting…" AI-generate input | New backend feature — needs its own spec |
| Suggestion chips | Depends on AI-generate input |
| Sidebar collapse/expand | Cosmetic, low priority |
| Persisted view toggle preference | Needs `user_settings` schema change or localStorage |
| Inline upload (no navigation to `/upload`) | Needs upload-zone refactor |
| Mobile adaptation | Requires responsive sidebar (hamburger/drawer pattern) — separate effort |
| Dark theme toggle | Not in reference; light-only is simpler |

---

## 13. Implementation Order

1. **CSS token change** — `--background` in `globals.css` (1 line, validates the visual direction immediately)
2. **AppShell + AppSidebar + AppTopBar** — the structural skeleton. Get it rendering on all pages. Remove AppHeader and UserNav.
3. **Home page restructure** — creation module + "Your Recordings" section header. Empty state.
4. **RecordingCard + CardGrid** — new card components, grid layout.
5. **Refactor history-list** — extract `use-recordings` hook, simplify list view, wire toggle.
6. **Integrate recording workspace** — ensure recording detail page renders inside shell.
7. **Integrate org workspace** — ensure org pages render inside shell.
8. **Polish pass** — status pills, hover states, transitions, edge cases.

---

*Spec written 2026-08-12. Based on 16-point grilling session over the OpenAI Platform "Chat Prompts" reference. All OpenAI-specific details discarded; 6 design principles adapted to Convene AI's data model and feature set.*
