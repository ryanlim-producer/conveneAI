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
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Check, Clock, MessageSquare, Pencil, ScrollText, Users } from "lucide-react";

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
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

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

  async function saveName() {
    if (!detail || !nameDraft.trim()) return setRenaming(false);
    const res = await fetch(`/api/history/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: nameDraft.trim() }),
    });
    if (res.ok) {
      setDetail({ ...detail, filename: nameDraft.trim() });
      toast.success("Recording renamed");
    } else {
      toast.error("Could not rename the recording.");
    }
    setRenaming(false);
  }

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
            {renaming ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveName();
                }}
              >
                <Input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-8 w-64"
                  data-testid="rename-input"
                />
                <Button type="submit" size="sm" variant="ghost" data-testid="rename-save">
                  <Check className="h-4 w-4" />
                </Button>
              </form>
            ) : (
              <h1 className="group flex items-center gap-2 truncate text-xl font-semibold">
                {detail.filename}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Rename recording"
                  onClick={() => {
                    setNameDraft(detail.filename);
                    setRenaming(true);
                  }}
                  data-testid="rename-button"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </h1>
            )}
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

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col overflow-hidden">
          <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
            {tab === "chat" ? (
              <ChatWindow recordingId={detail.id} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="transcript-scroll">
                <TranscriptPanel
                  segments={detail.segments}
                  speakers={detail.speakers}
                  fullTranscript={detail.fullTranscript}
                />
              </div>
            )}
          </CardContent>
        </Card>
        <ActionItemsSidebar items={detail.actionItems} recordingId={detail.id} />
      </div>
    </div>
  );
}
