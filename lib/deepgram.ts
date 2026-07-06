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

  // Convert Buffer to Uint8Array for Turbopack compatibility
  const body = new Uint8Array(audioBuffer);

  const response = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/mpeg",
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
