import { NextRequest, NextResponse } from "next/server";
import { downloadTelegramAudio } from "@/lib/telegram-audio";
import {
  getBotToken,
  getWebhookSecret,
  sendTelegramMessage,
  sendChunkedText,
  answerCallbackQuery,
} from "@/lib/telegram-bot";

function verifyToken(req: NextRequest): boolean {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  // Accept the sha256 webhook secret (set via setWebhook) or the raw token
  // (legacy/test callers). Telegram itself can't send the raw token because
  // secret_token forbids the ":" character.
  return secret === getWebhookSecret() || secret === getBotToken();
}

/** Resolve which user account a Telegram sender's recordings belong to. */
async function resolveUserId(telegramUserId: number | undefined): Promise<string | null> {
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  if (telegramUserId) {
    const link = db
      .prepare("SELECT user_id FROM telegram_links WHERE telegram_user_id = ? AND user_id IS NOT NULL")
      .get(telegramUserId) as { user_id: string } | undefined;
    if (link) return link.user_id;
  }

  // Unlinked sender: fall back to the first user with a Deepgram key so the
  // pipeline still works for the single-user BYOK setup.
  const keyRow = db
    .prepare("SELECT user_id FROM api_keys WHERE provider = 'deepgram' AND user_id IS NOT NULL LIMIT 1")
    .get() as { user_id: string } | undefined;
  return keyRow?.user_id ?? null;
}

async function handleAudioMessage(
  chatId: number,
  telegramUserId: number | undefined,
  fileId: string,
): Promise<void> {
  try {
    const userId = await resolveUserId(telegramUserId);
    if (!userId) {
      await sendTelegramMessage(
        chatId,
        "⚠️ Your Telegram isn't linked to an AsisVoz account yet.\n\n" +
          "Log in to the web UI, generate a code, then send `/link CODE` here.",
      );
      return;
    }

    const { buffer, filename } = await downloadTelegramAudio(fileId);

    const { newId } = await import("@/lib/db");
    const { audioKey, uploadAudio } = await import("@/lib/s3");
    const { contentTypeFor } = await import("@/lib/audio-files");
    const { enqueueJob } = await import("@/lib/queue");
    const { nudgeWorker } = await import("@/lib/worker");

    const jobId = newId();
    const s3Key = audioKey(userId, jobId, filename);
    await uploadAudio(s3Key, buffer, contentTypeFor(filename));

    enqueueJob({
      id: jobId,
      userId,
      filename,
      s3Key,
      source: "telegram",
    });
    nudgeWorker();

    await sendTelegramMessage(
      chatId,
      `🎙 *Processing audio...*\n\nYour recording is queued (job \`${jobId.slice(0, 8)}\`). ` +
        `I'll send the action items here when it's done.\n\n` +
        `💡 Reply to this message with a name for the recording.`,
    );
  } catch (err) {
    console.error("Telegram audio processing error:", err);
    await sendTelegramMessage(
      chatId,
      "❌ Sorry, there was an error processing your audio. Please try again.",
    );
  }
}

/** Inline "Copy Full Transcript" button — sends the transcript as text messages. */
async function handleCallbackQuery(callbackQuery: {
  id: string;
  data?: string;
  message?: { chat: { id: number } };
}): Promise<void> {
  await answerCallbackQuery(callbackQuery.id);

  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat.id;
  if (!data?.startsWith("copy:") || !chatId) return;

  const recordingId = data.slice("copy:".length);
  const { getDb } = await import("@/lib/db");
  const row = getDb()
    .prepare("SELECT transcript_text FROM recordings WHERE id = ?")
    .get(recordingId) as { transcript_text: string | null } | undefined;

  if (!row?.transcript_text) {
    await sendTelegramMessage(chatId, "⚠️ Transcript not found — it may have been deleted.");
    return;
  }

  await sendChunkedText(chatId, row.transcript_text);
}

/** Replying to the bot's "queued (job `xxxxxxxx`)" message names the recording. */
async function handleNamingReply(
  chatId: number,
  telegramUserId: number | undefined,
  repliedText: string,
  name: string,
): Promise<boolean> {
  const match = repliedText.match(/job `([0-9a-f]{8})`/);
  if (!match) return false;

  const userId = await resolveUserId(telegramUserId);
  if (!userId) return false;

  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const job = db
    .prepare("SELECT id, recording_id FROM jobs WHERE user_id = ? AND id LIKE ?")
    .get(userId, `${match[1]}%`) as { id: string; recording_id: string | null } | undefined;
  if (!job) return false;

  const trimmed = name.trim();
  if (!trimmed) return false;

  db.prepare("UPDATE jobs SET filename = ? WHERE id = ?").run(trimmed, job.id);
  if (job.recording_id) {
    db.prepare("UPDATE recordings SET filename = ? WHERE id = ?").run(trimmed, job.recording_id);
  }

  await sendTelegramMessage(chatId, `✏️ Recording renamed to *${trimmed}*.`);
  return true;
}

/** /link CODE — connect this Telegram user to a web account. */
async function handleLinkCommand(
  chatId: number,
  telegramUserId: number,
  text: string,
): Promise<void> {
  const code = text.replace("/link", "").trim().toUpperCase();
  if (!code) {
    await sendTelegramMessage(
      chatId,
      "Usage: `/link CODE`\n\nGet your code from the web UI (Settings → Link Telegram).",
    );
    return;
  }

  const { getDb, newId } = await import("@/lib/db");
  const db = getDb();

  const codeRow = db
    .prepare(
      "SELECT user_id FROM link_codes WHERE code = ? AND user_id IS NOT NULL AND created_at > datetime('now', '-15 minutes')",
    )
    .get(code) as { user_id: string } | undefined;

  if (!codeRow) {
    await sendTelegramMessage(
      chatId,
      "❌ Invalid or expired code. Generate a new one from the web UI.",
    );
    return;
  }

  const existing = db
    .prepare("SELECT id FROM telegram_links WHERE user_id = ?")
    .get(codeRow.user_id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE telegram_links SET telegram_user_id = ?, telegram_chat_id = ?, created_at = datetime('now') WHERE id = ?",
    ).run(telegramUserId, chatId, existing.id);
  } else {
    db.prepare(
      "INSERT INTO telegram_links (id, user_id, telegram_user_id, telegram_chat_id) VALUES (?, ?, ?, ?)",
    ).run(newId(), codeRow.user_id, telegramUserId, chatId);
  }

  db.prepare("DELETE FROM link_codes WHERE code = ?").run(code);

  await sendTelegramMessage(
    chatId,
    "✅ *Linked!* Your Telegram is now connected to your AsisVoz account.\n\n" +
      "• Recordings you send here appear in the web UI\n" +
      "• Action items from desktop recordings arrive here",
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const update = await req.json();

    // Inline button presses
    if (update.callback_query) {
      handleCallbackQuery(update.callback_query).catch((err) =>
        console.error("Callback query error:", err),
      );
      return NextResponse.json({ ok: true });
    }

    if (!update.message) {
      return NextResponse.json({ ok: true });
    }

    const { message } = update;
    const chatId = message.chat.id as number;
    const telegramUserId = message.from?.id as number | undefined;

    // A text reply to the bot's "queued" message names that recording
    if (message.text && message.reply_to_message?.text && !message.text.startsWith("/")) {
      const handled = await handleNamingReply(
        chatId,
        telegramUserId,
        message.reply_to_message.text,
        message.text,
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    if (message.text?.startsWith("/start")) {
      await sendTelegramMessage(
        chatId,
        `🎙 *AsisVoz* — Meeting Transcription + Action Items\n\n` +
          `Send me an audio file and I'll queue it for transcription, detect speakers, and extract action items.\n\n` +
          `You'll get back:\n` +
          `• Full transcript with speaker labels\n` +
          `• Action items with assignees and deadlines\n` +
          `• A link to view in the web UI\n\n` +
          `Link your account with /link CODE (get the code in the web UI).`,
      );
    } else if (message.text?.startsWith("/link") && telegramUserId) {
      await handleLinkCommand(chatId, telegramUserId, message.text);
    }

    const audioFileId =
      message.voice?.file_id || message.audio?.file_id || message.document?.file_id;
    if (audioFileId) {
      // Fire and forget — Telegram needs a fast 200 or it retries the update
      handleAudioMessage(chatId, telegramUserId, audioFileId).catch((err) =>
        console.error("Async audio handler error:", err),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
