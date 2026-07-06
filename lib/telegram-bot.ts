import { createHash } from "crypto";
import { getDb } from "@/lib/db";
import { formatTranscriptionReply } from "@/lib/telegram-reply";
import type { ActionItem } from "@/lib/action-extractor";

const TELEGRAM_API = "https://api.telegram.org";

export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

/**
 * Telegram's setWebhook secret_token only allows [A-Za-z0-9_-], but bot tokens
 * contain a colon — so we register a sha256 hex digest of the token instead.
 */
export function getWebhookSecret(): string {
  return createHash("sha256").update(getBotToken()).digest("hex");
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: unknown,
  opts?: { plain?: boolean },
): Promise<void> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // Raw transcripts can contain Markdown-breaking chars — send those plain
      ...(opts?.plain ? {} : { parse_mode: "Markdown" }),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

export async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = getBotToken();
  await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch((err) => console.error("answerCallbackQuery failed:", err));
}

let cachedBotUsername: string | null = null;

export async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const token = getBotToken();
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result?.username) {
      cachedBotUsername = data.result.username as string;
      return cachedBotUsername;
    }
  } catch {
    // fall through to env/default
  }
  return process.env.TELEGRAM_BOT_USERNAME || "conveneAI_bot";
}

/**
 * After a recording finishes processing, deliver the action items to the
 * Telegram chat linked to this user account. Best effort — never throws.
 */
export async function notifyLinkedTelegram(
  userId: string,
  recordingId: string,
  actionItems: ActionItem[],
  durationSeconds: number,
  speakerCount: number,
): Promise<void> {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;

    const link = getDb()
      .prepare("SELECT telegram_chat_id FROM telegram_links WHERE user_id = ?")
      .get(userId) as { telegram_chat_id: number } | undefined;
    if (!link) return;

    const reply = formatTranscriptionReply(
      actionItems,
      durationSeconds,
      speakerCount,
      recordingId,
    );
    await sendTelegramMessage(link.telegram_chat_id, reply.text, reply.replyMarkup);
  } catch (err) {
    console.error("notifyLinkedTelegram failed:", err);
  }
}

/** Send long text as multiple messages within Telegram's 4096-char limit. */
export async function sendChunkedText(chatId: number, text: string): Promise<void> {
  const CHUNK = 4000;
  for (let i = 0; i < text.length; i += CHUNK) {
    await sendTelegramMessage(chatId, text.slice(i, i + CHUNK), undefined, { plain: true });
  }
}
