import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDb, newId } from "@/lib/db";

export const POST = withAuth(async (req: NextRequest, { user }) => {
  let body: { telegramUserId?: unknown; telegramChatId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { telegramUserId, telegramChatId } = body;

  if (!telegramUserId || typeof telegramUserId !== "number") {
    return NextResponse.json({ error: "Missing or invalid telegramUserId." }, { status: 400 });
  }
  if (!telegramChatId || typeof telegramChatId !== "number") {
    return NextResponse.json({ error: "Missing or invalid telegramChatId." }, { status: 400 });
  }

  const db = getDb();

  // Upsert: one link per user
  const existing = db
    .prepare("SELECT id FROM telegram_links WHERE user_id = ?")
    .get(user.userId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE telegram_links SET telegram_user_id = ?, telegram_chat_id = ?, created_at = datetime('now') WHERE id = ?",
    ).run(telegramUserId, telegramChatId, existing.id);
  } else {
    db.prepare(
      "INSERT INTO telegram_links (id, user_id, telegram_user_id, telegram_chat_id) VALUES (?, ?, ?, ?)",
    ).run(newId(), user.userId, telegramUserId, telegramChatId);
  }

  return NextResponse.json({ linked: true });
});
