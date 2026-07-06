import { describe, it, expect } from "vitest";
import { mergeChunkResults, normalizeSpeakersByName } from "@/lib/batch-merge";
import type { TranscriptionResult } from "@/lib/deepgram";

function chunk(
  transcript: string,
  words: [speaker: number, text: string, start: number, end: number][],
  duration: number,
): TranscriptionResult {
  return {
    fullTranscript: transcript,
    segments: words.map(([speaker, text, start, end]) => ({
      speaker,
      text,
      start,
      end,
      confidence: 0.95,
    })),
    duration,
    speakerCount: new Set(words.map(([s]) => s)).size,
  };
}

describe("mergeChunkResults", () => {
  it("concatenates transcripts and offsets timestamps by the preceding chunks' durations", () => {
    const merged = mergeChunkResults([
      chunk("Hola equipo.", [[0, "Hola", 0.5, 1.0], [0, "equipo.", 1.1, 1.6]], 1800),
      chunk("Sigamos ahora.", [[0, "Sigamos", 2.0, 2.5], [1, "ahora.", 3.0, 3.4]], 900),
    ]);

    expect(merged.fullTranscript).toBe("Hola equipo. Sigamos ahora.");
    expect(merged.duration).toBe(2700);
    // second chunk timestamps offset by first chunk duration (1800)
    expect(merged.segments[2].start).toBe(1802.0);
    expect(merged.segments[3].end).toBe(1803.4);
  });

  it("offsets chunk-local speaker IDs so different chunks never collide (chunk N speaker s → N*10+s)", () => {
    const merged = mergeChunkResults([
      chunk("a", [[0, "a", 0, 1], [1, "b", 1, 2]], 1800),
      chunk("c", [[0, "c", 0, 1]], 1800),
    ]);

    expect(merged.segments.map((s) => s.speaker)).toEqual([0, 1, 10]);
    expect(merged.speakerCount).toBe(3);
  });
});

describe("normalizeSpeakersByName", () => {
  it("merges speakers that share a detected name into one consistent ID", () => {
    const segments = [
      { speaker: 0, text: "Hola", start: 0, end: 1, confidence: 0.9 },
      { speaker: 1, text: "Buenas", start: 1, end: 2, confidence: 0.9 },
      { speaker: 10, text: "Sigo yo", start: 1801, end: 1802, confidence: 0.9 },
    ];
    // name detection on the combined transcript says chunk-0 speaker 0 and chunk-1 speaker 10 are both María
    const detected = { "Speaker 0": "María", "Speaker 1": "Carlos", "Speaker 10": "María" };

    const result = normalizeSpeakersByName(segments, detected);

    const maria = result.segments[0].speaker;
    expect(result.segments[2].speaker).toBe(maria);
    expect(result.segments[1].speaker).not.toBe(maria);
    expect(result.speakerMap[`Speaker ${maria}`]).toBe("María");
    expect(result.speakerCount).toBe(2);
  });

  it("keeps generically-labelled speakers separate (fallback: no accidental merging)", () => {
    const segments = [
      { speaker: 0, text: "a", start: 0, end: 1, confidence: 0.9 },
      { speaker: 10, text: "b", start: 1801, end: 1802, confidence: 0.9 },
    ];
    const detected = { "Speaker 0": "Speaker 0", "Speaker 10": "Speaker 10" };

    const result = normalizeSpeakersByName(segments, detected);

    expect(result.segments[0].speaker).not.toBe(result.segments[1].speaker);
    expect(result.speakerCount).toBe(2);
  });
});
