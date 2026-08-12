# Feature Docs

Planning, design, and implementation artifacts. These are the documents that drive the code — not the code itself.

## How to Navigate

Every agent entering this directory should follow this path:

1. **This file** — find your feature in the index below
2. **Feature README** (`<feature>/README.md`) — find your implementation
3. **Implementation README** (`<feature>/<impl>/README.md`) — learn the structure
4. **ITERATIONS.md** (`<feature>/<impl>/ITERATIONS.md`) — know which iteration is current, read the previous report and current spec

```
feature-docs/README.md → <feature>/README.md → <impl>/README.md → <impl>/ITERATIONS.md
```

## Conventions

- **Feature** = a user-facing capability or major subsystem
- **Implementation** = a shippable increment within a feature, may go through multiple iterations
- **Iteration** = one full `/to-prd → /to-issues scale → /tdd → report` cycle within an implementation
- `shared/` = artifacts that span iterations (architecture, scripts, fixes)
- `iter-N/` = artifacts specific to one iteration (references, spec, report)
- `ITERATIONS.md` = the single source of truth for what iteration we're on

## Features

| Feature | Implementations | Status |
|---|---|---|
| [saas-ui-ux](saas-ui-ux/README.md) | [improvement-to-uiux](saas-ui-ux/improvement-to-uiux/README.md) | 🔄 in-progress |
| [saas-ui-ux](saas-ui-ux/README.md) | [folder-card-ui](saas-ui-ux/folder-card-ui/ITERATIONS.md) | ✅ complete |

> **Auto-updated by `/scaffold-implementation-docs`.** When scaffolding a new implementation, the skill reads and updates this table. Do not edit manually.
