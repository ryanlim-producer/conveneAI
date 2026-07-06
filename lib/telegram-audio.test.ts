import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadTelegramAudio } from "@/lib/telegram-audio";

process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-12345";

describe("downloadTelegramAudio", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads audio file from Telegram given a file_id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // First call: getFile to resolve file_id → file_path
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          result: { file_id: "abc123", file_path: "audio/voice_note.mp3" },
        }),
        { status: 200 },
      ),
    );

    // Second call: download the actual file
    fetchSpy.mockResolvedValueOnce(
      new Response(Buffer.from("fake-audio-bytes"), { status: 200 }),
    );

    const result = await downloadTelegramAudio("abc123");

    expect(result.filename).toBe("voice_note.mp3");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.toString()).toBe("fake-audio-bytes");
  });

  it("throws when getFile API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "Invalid file_id" }), {
        status: 400,
      }),
    );

    await expect(downloadTelegramAudio("bad-id")).rejects.toThrow(
      "Failed to get Telegram file info",
    );
  });

  it("throws when file download fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, result: { file_path: "audio/file.mp3" } }),
        { status: 200 },
      ),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    await expect(downloadTelegramAudio("abc123")).rejects.toThrow(
      "Failed to download audio",
    );
  });
});
