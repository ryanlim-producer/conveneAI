# UI Description — OpenAI Platform, "Chat Prompts" Screen

**Source:** Screenshot, curated by Mobbin (workspace labeled "ASMobbin")
**Product:** OpenAI Platform (developer dashboard)
**Screen:** Chat > Chat prompts (empty-ish state with 2 saved items)

---

## 1. Page Chrome

**Top bar** (fixed, full-width, off-white `#F9F9F8`-ish background, no visible border):
- Left: workspace switcher — circular avatar badge ("A"), workspace name "ASMobbin" with chevron, "/" separator, "Default project" with chevron. Two-level breadcrumb pattern, both dropdowns.
- Right: "Dashboard" (active/bold), "API Docs" (secondary weight), settings gear icon, circular user avatar. Simple horizontal nav-link + icon cluster, no button styling — text links only.

**Left sidebar** (fixed, ~320px, white background, right border hairline):
- Grouped into three labeled sections using small uppercase-ish gray section headers: **Create**, **Manage**, **Optimize**.
- **Create:** Chat (active — gray pill background), Agent Builder, Audio, Images, Videos, Assistants.
- **Manage:** Usage, API keys, ChatGPT Apps, Logs, Storage, Batches.
- **Optimize:** Evaluation, Fine-tuning.
- Each item: 20px line icon (outline style, consistent stroke weight) + label, single row height, generous vertical spacing (~44-48px per row). Active state = light gray rounded rectangle behind the row, no accent color used — purely a neutral-fill selection state.
- Bottom of sidebar: sidebar-collapse toggle icon, isolated at the base.

**Bottom bar** (fixed footer, full-width, near-black background):
- Left: OpenAI logo mark (black square) + "OpenAI Platform" wordmark.
- Right: "curated by" (muted gray) + Mobbin logo mark + "Mobbin" wordmark.
- This is Mobbin's own attribution chrome, not part of the OpenAI product — a wrapper the capture tool adds. Worth noting so it's not mistaken for OpenAI's actual UI.

---

## 2. Main Content Area

**Header:** "Chat prompts" — large serif/bold-sans heading, left-aligned, top of content area, generous top padding separating it from the top bar.

**Primary empty-state / creation module** (centered horizontally in the content column, roughly upper-middle of viewport):
- Headline: "Create a chat prompt" — bold, centered, largest text on the page after nothing else competing — clearly the primary CTA moment.
- Action row directly below, centered:
  - **Create** button: black fill, white text, "+" icon prefix, pill/rounded-rect shape. This is the dominant, highest-contrast interactive element on the entire screen.
  - **Generate…** input field: adjacent to the Create button, pill-shaped, light gray border, placeholder text "Generate…", with a circular black submit/arrow button embedded at its right edge. This pairs a manual-create path with an AI-generate path side by side — two entry points into the same object type.
- **Suggestion chips**, two rows, centered, pill-shaped with light gray fill, no border: "Trip planner," "Image generator," "Code debugger" (row 1); "Research assistant," "Decision helper" (row 2). These act as one-click template starters — reduces blank-canvas friction for the Generate field above.

**Secondary section — "Your prompts":**
- Left-aligned section label, smaller/darker than the hero headline, clear visual demotion from the create module above it.
- Two cards in a horizontal row (grid, fixed card width, left-aligned to content column, not centered):
  - Each card: white background, light border, rounded corners, subtle shadow-free flat style.
  - Card contents: blue rounded-square icon badge (chat-bubble glyph) top-left, prompt name below in medium-bold weight ("Trip," "Critique Assistant"), then a metadata row at the bottom — timestamp left ("Feb 26, 12:03 AM" / "Feb 25, 11:55 PM"), author name right ("Alex Smith") in muted gray.
  - Cards are click targets (implied), no visible hover/action affordance in this static state — likely open the prompt on click.
- Remaining grid space (right side, below) is empty — layout is a responsive grid that hasn't filled, not an intentionally short list.

---

## 3. Visual System (inferred tokens)

| Attribute | Observation |
|---|---|
| Background | Off-white / warm gray (`~#F9F9F8`), not pure white |
| Surface (cards, sidebar) | Pure white with 1px light-gray borders |
| Primary action color | **Black**, not a brand accent — Create button and submit arrow are both black-on-white. No blue/purple "AI" accent color used anywhere except the small blue icon badges on prompt cards. |
| Accent usage | Minimal — blue only appears on the chat-icon badges, functioning as a category-color, not a CTA color |
| Typography | Two-tier: a heavier/serif-leaning display face for headlines ("Chat prompts," "Create a chat prompt"), a neutral sans for body/labels/nav |
| Shape language | Consistent large border-radius across buttons, chips, input, and cards — pill/rounded-rect throughout, no sharp corners |
| Icon style | Uniform outline/line icons at small size in the sidebar; no filled icons mixed in |
| Density | Low — wide gutters, large vertical rhythm, sidebar rows tall. Reads as "calm developer tool," not data-dense |

---

## 4. UX Pattern Notes

- **Dual-path creation** (manual button + natural-language generate field) is the single most notable pattern here — it's hedging between power-users who know exactly what they want and users who'd rather describe intent and get scaffolding.
- **Suggestion chips as cold-start scaffolding** directly under a NL input is now a standard pattern (same shape as ChatGPT's own homepage) — reduces the "blank text box" abandonment problem.
- **Empty state over-indexes on the create module**, secondary content ("Your prompts") is visually demoted even though the user already has saved items — this reads as an interface optimized for *new* creation over *management* of existing prompts, which may be a deliberate growth lever (more prompts created) rather than a workflow optimization for returning users with many prompts. If this account had 50 prompts instead of 2, this layout would likely feel wrong — no search, filter, or sort control is visible anywhere on the "Your prompts" section, which is a real gap once volume increases.
