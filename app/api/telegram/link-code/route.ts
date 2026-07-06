import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { withAuth } from "@/lib/with-auth";
import { getDb } from "@/lib/db";
import { getBotUsername } from "@/lib/telegram-bot";

/** Generate a short-lived code the user sends to the bot as /link CODE. */
export const POST = withAuth(async (_req: NextRequest, { user }) => {
  const db = getDb();

  // 6-char alphanumeric, unambiguous (no 0/O/1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];

  // One active code per user
  db.prepare("DELETE FROM link_codes WHERE user_id = ?").run(user.userId);
  db.prepare("INSERT INTO link_codes (code, user_id) VALUES (?, ?)").run(code, user.userId);

  const botUsername = await getBotUsername();

  return NextResponse.json({
    code,
    botUsername,
    instructions: `Send /link ${code} to @${botUsername} on Telegram within 15 minutes.`,
    expiresInMinutes: 15,
  });
});

/** Report whether this user has a linked Telegram account. */
export const GET = withAuth(async (_req: NextRequest, { user }) => {
  const link = getDb()
    .prepare("SELECT telegram_user_id FROM telegram_links WHERE user_id = ?")
    .get(user.userId) as { telegram_user_id: number } | undefined;

  return NextResponse.json({ linked: Boolean(link) });
});
