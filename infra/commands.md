# Common Commands

> All commands assume SSH key at `~/.ssh/id_ed25519`

## One-liners (run from your machine)

```bash
# Check app is alive
ssh root@5.223.84.152 "pm2 status"

# Restart app
ssh root@5.223.84.152 "pm2 restart asisvoz"

# View recent logs
ssh root@5.223.84.152 "pm2 logs asisvoz --lines 30 --nostream"

# Check disk space
ssh root@5.223.84.152 "df -h /"

# Check database size
ssh root@5.223.84.152 "ls -lh /srv/asisvoz/data/conveneai.db"

# Query DB
ssh root@5.223.84.152 "sqlite3 /srv/asisvoz/data/conveneai.db 'SELECT COUNT(*) FROM users;'"

# List recent backups
ssh root@5.223.84.152 "ls -lt /srv/backups/ | head"

# Test HTTPS
curl -sI https://5.223.84.152.sslip.io/ | head -5

# Check nginx status
ssh root@5.223.84.152 "systemctl status nginx"

# Check TLS cert expiry
ssh root@5.223.84.152 "openssl x509 -enddate -noout -in /etc/letsencrypt/live/5.223.84.152.sslip.io/fullchain.pem"
```

## Deploy workflow

```bash
# 1. Push code to git
git push origin main

# 2. Pull + restart on server
ssh root@5.223.84.152 "cd /srv/asisvoz && git pull && npm install && pm2 restart asisvoz"

# 3. Verify
curl -sI https://5.223.84.152.sslip.io/ | head -3
```

## Debugging

```bash
# Full PM2 info
ssh root@5.223.84.152 "pm2 info asisvoz"

# Live log stream
ssh root@5.223.84.152 "pm2 logs asisvoz --lines 0"

# Check if port 80 is responding (if the site seems down)
ssh root@5.223.84.152 "nft list ruleset"   # stale NAT rules gotcha

# nginx error log
ssh root@5.223.84.152 "tail -50 /var/log/nginx/error.log"

# System resource usage
ssh root@5.223.84.152 "top -b -n1 | head"

# Check cron jobs
ssh root@5.223.84.152 "crontab -l"
```

## Gotchas

1. **Stale nftables NAT rules** — If port 80 "refuses" connections, check `nft list ruleset` for redirect 80→8001 rules (were removed 2026-07-07 but not persisted)
2. **Two databases** — Always query `conveneai.db`, never `asisvoz.db`
3. **Port 8000** — Belongs to another project, leave it alone
4. **Node version** — Server runs 22.23.1, don't downgrade
