# conveneAI Infrastructure Reference

> **Purpose:** Any agent reading this folder can SSH into production and manage the server.
> **Last updated:** 2026-07-13

## Quick Connect

```bash
ssh -i infra/.ssh/id_ed25519 root@5.223.84.152
```

SSH key is bundled in `infra/.ssh/id_ed25519` — no external dependencies. Everything an agent needs is in this folder.

## Files in this folder

| File | Contents |
|---|---|
| `server-layout.md` | Paths, PM2, nginx, TLS, backups — where everything lives |
| `database.md` | Schema, two-DB gotcha, how to query production data |
| `commands.md` | Common SSH commands — restart, logs, deploy, debug |

## ⚠️ Critical facts

- **Active DB:** `/srv/asisvoz/data/conveneai.db` (NOT `asisvoz.db` — that's legacy dead data)
- **PM2 process:** `asisvoz`
- **App URL:** `https://5.223.84.152.sslip.io/`
- **Port 8000 on VPS:** belongs to another project, leave it alone
