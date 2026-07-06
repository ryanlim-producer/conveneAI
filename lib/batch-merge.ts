import type { TranscriptSegment, TranscriptionResult } from "./deepgram";

// Chunk-local speaker s in chunk N becomes global N*10+s. Deepgram rarely
// finds >10 speakers in one chunk; the stride just has to prevent collisions.
const SPEAKER_STRIDE = 10;

/**
 * Merges per-chunk transcription results into one, offsetting timestamps by
 * the durations of the preceding chunks and speaker IDs by the chunk index
 * (so speakers from different chunks never collide before name-based
 * normalization runs).
 */
export function mergeChunkResults(chunks: TranscriptionResult[]): TranscriptionResult {
  const segments: TranscriptSegment[] = [];
  let timeOffset = 0;
  const speakers = new Set<number>();

  chunks.forEach((chunk, index) => {
    for (const seg of chunk.segments) {
      const speaker = index * SPEAKER_STRIDE + seg.speaker;
      speakers.add(speaker);
      segments.push({
        ...seg,
        speaker,
        start: seg.start + timeOffset,
        end: seg.end + timeOffset,
      });
    }
    timeOffset += chunk.duration;
  });

  return {
    fullTranscript: chunks.map((c) => c.fullTranscript).join(" ").trim(),
    segments,
    duration: timeOffset,
    speakerCount: speakers.size,
  };
}

/**
 * Re-assigns consistent speaker numbers after name detection ran on the
 * combined transcript: all offset speaker IDs that detected to the same real
 * name collapse into one ID. Speakers without a detected name (generic
 * "Speaker N" labels) stay separate — never accidentally merged.
 */
export function normalizeSpeakersByName(
  segments: TranscriptSegment[],
  detectedNames: Record<string, string>,
): { segments: TranscriptSegment[]; speakerMap: Record<string, string>; speakerCount: number } {
  const oldIds = [...new Set(segments.map((s) => s.speaker))].sort((a, b) => a - b);

  const idByName = new Map<string, number>();
  const newIdByOldId = new Map<number, number>();
  const speakerMap: Record<string, string> = {};
  let nextId = 0;

  for (const oldId of oldIds) {
    const name = detectedNames[`Speaker ${oldId}`];
    const isRealName = !!name && !/^Speaker \d+$/.test(name);

    if (isRealName && idByName.has(name)) {
      newIdByOldId.set(oldId, idByName.get(name)!);
      continue;
    }

    const newId = nextId++;
    newIdByOldId.set(oldId, newId);
    if (isRealName) idByName.set(name!, newId);
    speakerMap[`Speaker ${newId}`] = isRealName ? name! : `Speaker ${newId}`;
  }

  return {
    segments: segments.map((s) => ({ ...s, speaker: newIdByOldId.get(s.speaker)! })),
    speakerMap,
    speakerCount: nextId,
  };
}
