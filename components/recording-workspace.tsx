"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatWindow } from "@/components/chat-window";
import { ActionItemsSidebar, type ActionItem } from "@/components/action-items-sidebar";
import { TranscriptPanel } from "@/components/transcript-panel";
import { ArrowLeft, Clock, MessageSquare, ScrollText, Users } from "lucide-react";

interface RecordingDetail {
  id: string;
  filename: string;
  source: string;
  durationSeconds: number | null;
  speakerCount: number;
  fullTranscript: string;
  segments: { speaker: number; text: string; start: number; end: number }[];
  speakers: { id: string; name: string }[];
  actionItems: ActionItem[];
  hasAudio: boolean;
  createdAt: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingWorkspace({ recordingId }: { recordingId: string }) {
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "transcript">("chat");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/history/${recordingId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Not found");
        return r.json();
      })
      .then((d: RecordingDetail) => {
        setDetail(d);
        if (d.hasAudio) {
          fetch(`/api/history/${recordingId}/audio`)
            .then((r) => (r.ok ? r.json() : null))
            .then((a) => a && setAudioUrl(a.url))
            .catch(() => {});
        }
      })
      .catch((e) => setError(e.message));
  }, [recordingId]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link href="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to recordings
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4" data-testid="recording-loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div data-testid="recording-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" asChild data-testid="back-button">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{detail.filename}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatDuration(detail.durationSeconds)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" /> {detail.speakerCount} speaker
                {detail.speakerCount !== 1 ? "s" : ""}
              </span>
              <Badge variant="secondary">{detail.source}</Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-1" role="tablist">
          <Button
            variant={tab === "chat" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab("chat")}
            data-testid="tab-chat"
          >
            <MessageSquare className="mr-1 h-4 w-4" /> Chat
          </Button>
          <Button
            variant={tab === "transcript" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab("transcript")}
            data-testid="tab-transcript"
          >
            <ScrollText className="mr-1 h-4 w-4" /> Transcript
          </Button>
        </div>
      </div>

      {audioUrl && (
        <audio controls src={audioUrl} className="mt-4 w-full" data-testid="audio-player" />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="pt-6">
            {tab === "chat" ? (
              <ChatWindow recordingId={detail.id} />
            ) : (
              <TranscriptPanel
                segments={detail.segments}
                speakers={detail.speakers}
                fullTranscript={detail.fullTranscript}
              />
            )}
          </CardContent>
        </Card>
        <ActionItemsSidebar items={detail.actionItems} />
      </div>
    </div>
  );
}
