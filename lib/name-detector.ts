import { callLLM } from "@/lib/llm-client";
import type { TranscriptSegment } from "@/lib/deepgram";

export async function detectSpeakerNames(
  userId: string,
  segments: TranscriptSegment[],
  model = "deepseek/deepseek-r1",
): Promise<Record<string, string>> {
  // Build a transcript excerpt for the LLM prompt
  const transcriptLines = segments
    .map((s) => `[Speaker ${s.speaker}]: ${s.text}`)
    .join("\n");

  const uniqueSpeakers = [...new Set(segments.map((s) => s.speaker))].sort();

  const prompt = `You are analyzing a conversation transcript (any language). Your task is to detect the real names of each speaker by looking for:
- Direct address ("thanks Maria", "Carlos, your turn", "gracias María")
- Self-introductions ("I'm John", "my name is Ana", "soy Juan")
- Others referring to them by name

Speakers in this conversation: ${uniqueSpeakers.map((s) => `Speaker ${s}`).join(", ")}

Transcript excerpt:
${transcriptLines}

Return ONLY a JSON object mapping speaker IDs to detected names. If you can't detect a name for a speaker, use "Speaker N" as the value. Format: { "Speaker 0": "María", "Speaker 1": "Carlos" }`;

  try {
    const response = await callLLM(userId, {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      // Reasoning models (deepseek-r1) spend tokens on chain-of-thought before
      // the JSON answer — 300 gets truncated mid-reasoning and we silently
      // fall back to generic labels. Match the action extractor's budget.
      max_tokens: 2000,
    });

    // Try to extract JSON from the response (may be wrapped in markdown)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallback(uniqueSpeakers);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate it's a proper mapping
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return buildFallback(uniqueSpeakers);
    }

    // Merge detected names with fallback for missing speakers
    const result: Record<string, string> = {};
    for (const speaker of uniqueSpeakers) {
      const key = `Speaker ${speaker}`;
      const detected = parsed[key];
      result[key] = typeof detected === "string" && detected.length > 0
        ? detected
        : key;
    }

    return result;
  } catch {
    return buildFallback(uniqueSpeakers);
  }
}

function buildFallback(speakers: number[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const s of speakers) {
    result[`Speaker ${s}`] = `Speaker ${s}`;
  }
  return result;
}
