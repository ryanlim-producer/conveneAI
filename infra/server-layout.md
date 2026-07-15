# Server Layout

## Connection

```
Host:   5.223.84.152
User:   root
Key:    ~/.ssh/id_ed25519
```

```
ssh -i infra/.ssh/id_ed25519 root@5.223.84.152
```

## Directory structure

```
/srv/asisvoz/                    # App root
├── data/
│   ├── conveneai.db             # ✅ ACTIVE database (SQLite, WAL mode)
│   └── asisvoz.db               # ❌ LEGACY — do NOT query (old v1 data)
├── .env                         # Environment variables
├── node_modules/
├── package.json
└── ...                          # Next.js app files
```

## Process management (PM2)

| Item | Value |
|---|---|
| Process name | `asisvoz` |
| Runs as | root (pm2-root systemd unit) |
| Command | `npm start` (Next.js production mode) |
| Internal port | 3000 (nginx proxies from 443) |

### PM2 commands (run on server)

```bash
pm2 status                    # Check if running
pm2 restart asisvoz           # Restart after DB or code changes
pm2 logs asisvoz --lines 50   # Recent logs
pm2 logs asisvoz --lines 0    # Stream live logs (Ctrl+C to stop)
pm2 stop asisvoz              # Stop
pm2 start asisvoz             # Start
```

## nginx

| Item | Value |
|---|---|
| Site config | `/etc/nginx/sites-available/asisvoz` |
| Enabled symlink | `/etc/nginx/sites-enabled/asisvoz` |
| Special setting | `proxy_buffering off` on `/api/queue` (for SSE streaming) |

### nginx commands

```bash
nginx -t                          # Test config
systemctl reload nginx            # Apply config changes
systemctl status nginx            # Check status
```

## TLS (Let's Encrypt)

| Item | Value |
|---|---|
| Domain | `5.223.84.152.sslip.io` |
| Cert location | `/etc/letsencrypt/live/5.223.84.152.sslip.io/` |
| Auto-renew | systemd timer |

sslip.io is a free DNS service: `<ip>.sslip.io` resolves to `<ip>`. Used because Let's Encrypt won't issue certs for bare IPs.

## Backups

| Item | Value |
|---|---|
| Schedule | Daily at 3am (cron) |
| Method | sqlite3 `.backup` to `/srv/backups/` |
| Retention | 14 days |

## Environment variables (.env)

Located at `/srv/asisvoz/.env`. Contains:
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET`
- `DEEPGRAM_API_KEY`
- `AI_GATEWAY_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `DATABASE_PATH` (if set)
- Other app config

## Node version

22.23.1 (managed via nvm or system install)

## Port 8000

A localhost-only Python service on `:8000` belongs to another project. **Do not touch it.**
