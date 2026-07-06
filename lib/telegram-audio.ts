import path from "path";

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_FILE_API = "https://api.telegram.org/file";

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

export async function downloadTelegramAudio(
  fileId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const token = getBotToken();

  // Step 1: Resolve file_id → file_path
  const getFileRes = await fetch(
    `${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`,
  );
  const getFileData = await getFileRes.json();

  if (!getFileData.ok || !getFileData.result?.file_path) {
    throw new Error("Failed to get Telegram file info");
  }

  const filePath = getFileData.result.file_path;
  const filename = path.basename(filePath);

  // Step 2: Download the file
  const downloadRes = await fetch(
    `${TELEGRAM_FILE_API}/bot${token}/${filePath}`,
  );

  if (!downloadRes.ok) {
    throw new Error("Failed to download audio from Telegram");
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { buffer, filename };
}
