---
name: scaffold-implementation-docs
description: Scaffold feature-docs/<feature>/<implementation>/ with shared/ and iter-1/ subdirectories, ITERATIONS.md, and a README explaining the workflow.
---

# scaffold-implementation-docs

Scaffold the directory structure for a new implementation within an existing feature under `feature-docs/`. The implementation directory must already exist (created manually by the user). This skill populates it with the `shared/` and `iter-1/` structure, `ITERATIONS.md`, and a `README.md`.

## When to use

Trigger this skill when:
- The user has manually created an implementation directory under `feature-docs/<feature>/`
- The user is ready to start the first iteration of that implementation

## Process

1. **Identify the implementation directory.** The user will specify or their current context will indicate which implementation directory to scaffold. It must already exist on disk. If the directory does not exist, tell the user to create it first.

2. **Verify the parent feature.** Confirm the implementation lives under an existing `feature-docs/<feature>/` folder. If the feature folder doesn't exist, tell the user to create it first.

3. **Create the directory structure:**

   ```
   feature-docs/<feature-name>/<implementation-name>/
     README.md
     ITERATIONS.md
     shared/
       references/          # Architecture docs, design decisions — shared across all iterations
       scripts/             # DB scripts, seed data, helpers
       fixes/               # Bug-fix notes (symptom, root cause, fix, verification)
     iter-1/
       references/          # Iteration-specific exploration docs
       specs/               # Spec for this iteration (spec.md)
       implementation-reports/  # Report written by /tdd agent on completion
   ```

4. **Write ITERATIONS.md** using the template below. Fill in `{IMPLEMENTATION_NAME}`.

5. **Write README.md** using the template below. Fill in `{FEATURE_NAME}` and `{IMPLEMENTATION_NAME}`.

6. **Check for feature-level README.** If `feature-docs/<feature-name>/README.md` does not exist, create one using the feature-level template (see bottom of this skill).

7. **Update `feature-docs/README.md`.** Read the current file and update the Features table:
   - If the feature is **not yet listed**, append a new row: `| <feature-name> | [<impl-name>](<feature-name>/<impl-name>/README.md) | 🔄 in-progress |`
   - If the feature **already has a row**, append the new implementation link to its Implementations cell (comma-separated): `[impl-1](...), [impl-2](...)`
   - The Status column reflects the overall feature status: use the most recent implementation's status. When an implementation is first scaffolded, it's `🔄 in-progress`.
   - Write the updated table back to the file.

8. **Report** what was created and remind the user of the next step: write the iteration reference document in `iter-1/references/`, then write the spec in `iter-1/specs/spec.md`, then `/to-prd`.

## ITERATIONS.md Template

```markdown
# Iterations — {IMPLEMENTATION_NAME}

| # | Spec | Report | Status |
|---|---|---|---|
| 1 | [iter-1/specs/spec.md](iter-1/specs/spec.md) | [iter-1/implementation-reports/report.md](iter-1/implementation-reports/report.md) | 🔄 in-progress |
```

**Status values:** `🔄 in-progress` → `✅ complete`. The `/tdd` agent updates this table when it writes the implementation report.

## README Template (implementation-level)

```markdown
# {IMPLEMENTATION_NAME}

Implementation folder for the **{FEATURE_NAME}** feature. This implementation follows the feature documentation workflow.

## Structure

| Path | Purpose |
|---|---|
| `ITERATIONS.md` | Tracking table — which iteration is current, links to specs and reports |
| `shared/references/` | Architecture docs, design decisions — shared across all iterations |
| `shared/scripts/` | Shell scripts, DB scripts, test-data helpers |
| `shared/fixes/` | Bug-fix notes: symptom, root cause, fix, verification |
| `iter-N/references/` | Iteration-specific exploration docs |
| `iter-N/specs/` | Spec for this iteration — prescriptive (what to build) |
| `iter-N/implementation-reports/` | Report written by `/tdd` agent on completion |

## Flow

```
iter-1/references/  →  iter-1/specs/  →  /to-prd (→ GitHub issue)  →  /to-issues scale (→ GitHub child issues)  →  /tdd  →  iter-1/implementation-reports/
                                                                                                                       ↑
                                                                                                        /tdd agent marks iteration complete in ITERATIONS.md
```

1. **Reference document** — Discuss with AI, capture findings in `iter-1/references/<topic>.md`.
2. **Spec** — Grill yourself on the reference doc. Write the spec in `iter-1/specs/spec.md`.
3. **PRD** — Run `/to-prd` to convert the spec into a PRD on GitHub (`ready-for-agent`).
4. **Issues** — Run `/to-issues scale` to decompose into vertical-slice GitHub issues.
5. **Implement** — `/tdd` loop over each issue (tests first, code, iterate).
6. **Report** — The `/tdd` agent writes `iter-1/implementation-reports/report.md` and marks the iteration ✅ complete in ITERATIONS.md.

## Starting a New Iteration

If another pass is needed after iteration 1, use the `/start-new-iteration` skill. It creates `iter-2/` and appends a row to ITERATIONS.md.

## Key Rules

- `shared/references/` = design decisions that span iterations. `iter-N/references/` = exploration specific to that iteration.
- `shared/scripts/` and `shared/fixes/` are shared across all iterations.
- `ITERATIONS.md` is the single source of truth for what iteration we're on and its status.
- The `/tdd` agent updates ITERATIONS.md autonomously when an iteration completes.
- Each iteration is one `/to-prd` → `/to-issues scale` → `/tdd` cycle.
```

## Feature-Level README Template

If the feature folder exists but has no README, offer to create one:

```markdown
# {FEATURE_NAME}

Parent folder for all implementations of the **{FEATURE_NAME}** feature.

## How This Works

Each subdirectory is an **implementation** — a shippable increment that may go through multiple iterations. See any implementation's README and ITERATIONS.md for the detailed flow.

## Implementations

<!-- Add each implementation as it's created -->
- ...
```
