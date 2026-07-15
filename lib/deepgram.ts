export interface TranscriptSegment {
  speaker: number;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TranscriptionResult {
  fullTranscript: string;
  segments: TranscriptSegment[];
  duration: number;
  speakerCount: number;
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

export interface BalanceResult {
  amount: number;
  units: string;
}

export async function getBalance(apiKey: string): Promise<BalanceResult> {
  try {
    // Step 1: Get project ID
    const projectsResponse = await fetch(
      "https://api.deepgram.com/v1/projects",
      {
        method: "GET",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!projectsResponse.ok) {
      const errorBody = await projectsResponse.text();
      throw new Error(
        `Deepgram API error: ${projectsResponse.status} ${errorBody}`,
      );
    }

    const projectsData = await projectsResponse.json();
    const projects: { project_id: string }[] = projectsData.projects ?? [];

    if (projects.length === 0) {
      throw new Error(
        "Deepgram API error: no projects found for this API key",
      );
    }

    const projectId = projects[0].project_id;

    // Step 2: Get balances for that project
    const balancesResponse = await fetch(
      `https://api.deepgram.com/v1/projects/${projectId}/balances`,
      {
        method: "GET",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!balancesResponse.ok) {
      const errorBody = await balancesResponse.text();
      throw new Error(
        `Deepgram API error: ${balancesResponse.status} ${errorBody}`,
      );
    }

    const balancesData = await balancesResponse.json();
    const balances: { amount: number; units: string }[] =
      balancesData.balances ?? [];

    const totalAmount = balances.reduce(
      (sum: number, b: { amount: number }) => sum + b.amount,
      0,
    );
    const units = balances.length > 0 ? balances[0].units : "usd";

    return { amount: totalAmount, units };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Deepgram API error:")) {
      throw error;
    }
    throw new Error(`Deepgram API error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export const DEFAULT_DEEPGRAM_MODEL = "nova-3";

/** Detect audio container format from magic bytes. */
function detectAudioFormat(buffer: Buffer): "wav" | "mp3" | "ogg" | "mp4" | "webm" | "unknown" {
  if (buffer.length < 4) return "unknown";
  // RIFF....WAVE
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
      && buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
    return "wav";
  }
  // MP3: sync word 0xFF 0xFB/0xFA/0xF3/0xF2, or ID3 tag "ID3"
  if ((buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0)
      || (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)) {
    return "mp3";
  }
  // OGG: "OggS"
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return "ogg";
  }
  // MP4/M4A: ftyp box at offset 4
  if (buffer.length >= 12 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return "mp4";
  }
  // WebM: EBML header 0x1A 0x45 0xDF 0xA3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return "webm";
  }
  return "unknown";
}

function audioContentType(format: ReturnType<typeof detectAudioFormat>): string {
  switch (format) {
    case "wav": return "audio/wav";
    case "mp3": return "audio/mpeg";
    case "ogg": return "audio/ogg";
    case "mp4": return "audio/mp4";
    case "webm": return "audio/webm";
    default: return "audio/mpeg";
  }
}

export async function transcribeAudio(
  apiKey: string,
  audioBuffer: Buffer,
  language?: string,
  model: string = DEFAULT_DEEPGRAM_MODEL,
): Promise<TranscriptionResult> {
  const params = new URLSearchParams({
    model,
    diarize: "true",
    smart_format: "true",
  });
  if (language) {
    params.set("language", language);
  }

  const format = detectAudioFormat(audioBuffer);
  const contentType = audioContentType(format);

  const body = new Uint8Array(audioBuffer);

  const response = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
      },
      body,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Deepgram API error: ${response.status} ${errorBody}`,
    );
  }

  const data = await response.json();
  const metadata = data.metadata;
  const alternative = data.results?.channels?.[0]?.alternatives?.[0];
  const words: DeepgramWord[] = alternative?.words ?? [];
  const fullTranscript: string = alternative?.transcript ?? "";

  const speakerSet = new Set<number>();
  const segments: TranscriptSegment[] = words.map((w: DeepgramWord) => {
    const speaker = w.speaker ?? 0;
    speakerSet.add(speaker);
    return {
      speaker,
      text: w.punctuated_word ?? w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
    };
  });

  return {
    fullTranscript,
    segments,
    duration: metadata.duration ?? 0,
    speakerCount: speakerSet.size,
  };
}
