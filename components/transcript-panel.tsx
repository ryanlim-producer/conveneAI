"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";

interface Segment {
  speaker: number;
  text: string;
  start: number;
  end: number;
}

interface Speaker {
  id: string;
  name: string;
}

const SPEAKER_COLORS = [
  "text-blue-600 dark:text-blue-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-purple-600 dark:text-purple-400",
  "text-amber-600 dark:text-amber-400",
  "text-rose-600 dark:text-rose-400",
  "text-cyan-600 dark:text-cyan-400",
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Groups word-level segments into consecutive same-speaker utterances. */
function groupBySpeaker(segments: Segment[]): { speaker: number; start: number; text: string }[] {
  const groups: { speaker: number; start: number; text: string }[] = [];
  for (const seg of segments) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.text += ` ${seg.text}`;
    } else {
      groups.push({ speaker: seg.speaker, start: seg.start, text: seg.text });
    }
  }
  return groups;
}

export function TranscriptPanel({
  segments,
  speakers,
  fullTranscript,
}: {
  segments: Segment[];
  speakers: Speaker[];
  fullTranscript: string;
}) {
  const nameFor = useMemo(() => {
    const map = new Map(speakers.map((s) => [s.id, s.name]));
    return (speaker: number) => map.get(`Speaker ${speaker}`) ?? `Speaker ${speaker}`;
  }, [speakers]);

  const groups = useMemo(() => groupBySpeaker(segments), [segments]);

  async function copyAll() {
    const text =
      groups.length > 0
        ? groups.map((g) => `[${formatTime(g.start)}] ${nameFor(g.speaker)}: ${g.text}`).join("\n\n")
        : fullTranscript;
    await navigator.clipboard.writeText(text);
    toast.success("Transcript copied to clipboard");
  }

  async function copySegment(g: { speaker: number; start: number; text: string }) {
    await navigator.clipboard.writeText(`${nameFor(g.speaker)}: ${g.text}`);
    toast.success("Segment copied");
  }

  return (
    <div data-testid="transcript-panel">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={copyAll} data-testid="copy-transcript">
          <Copy className="mr-1 h-4 w-4" /> Copy transcript
        </Button>
      </div>
      {groups.length === 0 ? (
        <p className="mt-4 whitespace-pre-wrap text-sm">{fullTranscript || "No transcript."}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map((g, i) => (
            <div key={i} className="group text-sm" data-testid="transcript-segment">
              <div className="flex items-baseline gap-2">
                <span className={`font-semibold ${SPEAKER_COLORS[g.speaker % SPEAKER_COLORS.length]}`}>
                  {nameFor(g.speaker)}
                </span>
                <span className="text-xs text-muted-foreground">{formatTime(g.start)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                  title="Copy this segment"
                  onClick={() => copySegment(g)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="mt-0.5">{g.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
