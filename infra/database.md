# Database Reference

## ⚠️ Two databases — only one is active

| File | Status | Action |
|---|---|---|
| `/srv/asisvoz/data/conveneai.db` | **ACTIVE** | ✅ Query this |
| `/srv/asisvoz/data/asisvoz.db` | LEGACY (v1) | ❌ Do NOT query |

The old `asisvoz.db` is a vestige of the v1→v2 rename. It still exists on disk but is NOT connected to the running app.

## How to query production data

```bash
ssh root@5.223.84.152 "sqlite3 /srv/asisvoz/data/conveneai.db '<SQL>'"
```

Or interactively:
```bash
ssh -t root@5.223.84.152 "sqlite3 /srv/asisvoz/data/conveneai.db"
```

## Schema overview

```
users              — id, email (UNIQUE), password_hash (bcryptjs), created_at
user_sessions      — id, user_id (FK→users), token (UNIQUE), created_at, expires_at
recordings         — id, user_id (FK→users), job_id (FK→jobs), filename, source,
                     duration_seconds, speaker_count, s3_key, transcript_text,
                     segments_json, action_items_json, speaker_map_json,
                     model_used, cost_usd, group_name, group_id (FK→groups), created_at
jobs               — id, user_id (FK→users), recording_id (FK→recordings), status,
                     source, s3_key, filename, language, error_message,
                     model_used, attempts, created_at, started_at, completed_at
groups             — id, user_id (FK→users), name, created_at, UNIQUE(user_id, name)
chat_messages      — id, recording_id (FK→recordings), user_id (FK→users),
                     role (user|assistant), content, created_at
user_settings      — user_id (FK→users), deepgram_model, actions_llm_model,
                     chatbot_llm_model, created_at, updated_at
api_keys           — id, user_id (FK→users), provider, encrypted_key (AES-256-GCM), created_at
telegram_links     — id, user_id (FK→users), telegram_user_id, telegram_chat_id, created_at
link_codes         — code, user_id (FK→users), created_at
```

## Circular FK: recordings ↔ jobs

- `recordings` inserted first with `job_id = NULL`
- `jobs` inserted with `recording_id` pointing back
- `recordings.job_id` updated after job is created

## Useful queries

```sql
-- User count
SELECT COUNT(*) FROM users;

-- Recent recordings
SELECT id, filename, source, datetime(created_at, 'localtime') 
FROM recordings ORDER BY created_at DESC LIMIT 10;

-- Job status summary
SELECT status, COUNT(*) FROM jobs GROUP BY status;

-- Recordings by user
SELECT u.email, COUNT(r.id) 
FROM users u LEFT JOIN recordings r ON r.user_id = u.id 
GROUP BY u.id;

-- Telegram-linked users
SELECT u.email, tl.telegram_user_id 
FROM users u JOIN telegram_links tl ON tl.user_id = u.id;
```
