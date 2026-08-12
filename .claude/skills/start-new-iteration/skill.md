---
name: start-new-iteration
description: Create a new iteration folder (iter-N/) within an existing implementation, appending a row to ITERATIONS.md.
---

# start-new-iteration

Create a new iteration within an existing implementation. Reads the current `ITERATIONS.md` to determine the next iteration number, creates `iter-N/` with all standard subdirectories, and appends a row to the tracking table.

## When to use

Trigger this skill when:
- An implementation has at least one completed iteration
- The user wants to start another pass (refinement, extension, addressing caveats from the previous report)
- The user drops an implementation directory into chat and invokes this skill

## Process

1. **Identify the implementation directory.** The user will specify or their current context will indicate which implementation to iterate on. The directory must already exist and contain `ITERATIONS.md`.

2. **Read ITERATIONS.md.** Parse the table to find the highest iteration number. The new iteration is `N+1`.

3. **Verify the previous iteration is complete.** The last row in ITERATIONS.md should have status `✅ complete`. If it's still `🔄 in-progress`, warn the user but proceed (they may want to abandon the in-progress iteration).

4. **Create the new iteration structure:**

   ```
   feature-docs/<feature-name>/<implementation-name>/
     iter-<N>/
       references/
       specs/
       implementation-reports/
   ```

5. **Append a row to ITERATIONS.md:**

   ```markdown
   | N | [iter-N/specs/spec.md](iter-N/specs/spec.md) | [iter-N/implementation-reports/report.md](iter-N/implementation-reports/report.md) | 🔄 in-progress |
   ```

6. **Report** the new iteration number and link to the previous iteration's report for context. Remind the user: write the reference doc in `iter-N/references/`, then the spec in `iter-N/specs/spec.md`, then `/to-prd`.

## ITERATIONS.md Row Format

```markdown
| # | Spec | Report | Status |
|---|---|---|---|
| 1 | [iter-1/specs/spec.md](iter-1/specs/spec.md) | [iter-1/implementation-reports/report.md](iter-1/implementation-reports/report.md) | ✅ complete |
| 2 | [iter-2/specs/spec.md](iter-2/specs/spec.md) | [iter-2/implementation-reports/report.md](iter-2/implementation-reports/report.md) | 🔄 in-progress |
```

The `/tdd` agent updates `🔄 in-progress` → `✅ complete` when it writes the implementation report.

## Agent Guidance

When starting a new iteration, the agent should:
1. Read the previous iteration's **implementation report** — caveats and divergences are the starting point for the new spec
2. Read the previous iteration's **spec** — to understand what was planned
3. Read `shared/references/` — for architecture and design decisions that still apply
4. Write new exploration docs in `iter-N/references/` before writing the new spec
