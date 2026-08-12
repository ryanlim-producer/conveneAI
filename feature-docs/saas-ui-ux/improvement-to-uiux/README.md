# improvement-to-uiux

Implementation folder for the **saas-ui-ux** feature. This implementation follows the feature documentation workflow.

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
