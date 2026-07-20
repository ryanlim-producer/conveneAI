"use client";

import { api } from "@/lib/api-path";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatWindow } from "@/components/chat-window";
import { ActionItemsSidebar, type ActionItem } from "@/components/action-items-sidebar";
import { TranscriptPanel } from "@/components/transcript-panel";
import { OrgFab } from "@/components/org-fab";
import { ArrowLeft, Clock, Folder, MessageSquare, ScrollText, Users } from "lucide-react";

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
  groupId: string | null;
  groupName: string | null;
  createdAt: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function OrgRecordingWorkspace({
  orgId,
  orgSlug,
  recordingId,
  isOwner,
  memberId,
}: {
  orgId: string;
  orgSlug: string;
  recordingId: string;
  isOwner: boolean;
  memberId?: string;
}) {
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "transcript">("chat");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(api(`/api/org/${orgId}/recordings/${recordingId}`))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Not found");
        return r.json();
      })
      .then((d: RecordingDetail) => {
        setDetail(d);
        if (d.hasAudio) {
          fetch(api(`/api/org/${orgId}/recordings/${recordingId}/audio`))
            .then((r) => (r.ok ? r.json() : null))
            .then((a) => a && setAudioUrl(a.url))
            .catch(() => {});
        }
      })
      .catch((e) => setError(e.message));
  }, [orgId, recordingId]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link href={`/org/${orgSlug}`}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to organization
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4" data-testid="org-recording-loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const chatApiPrefix = api(`/api/org/${orgId}/chat`);

  return (
    <div data-testid="org-recording-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" asChild data-testid="org-recording-back">
            <Link href={`/org/${orgSlug}`}>
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
              {detail.groupName && (
                <Badge variant="outline" className="gap-1">
                  <Folder className="h-3 w-3" /> {detail.groupName}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1" role="tablist">
          <Button
            variant={tab === "chat" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab("chat")}
            data-testid="org-tab-chat"
          >
            <MessageSquare className="mr-1 h-4 w-4" /> Chat
          </Button>
          <Button
            variant={tab === "transcript" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab("transcript")}
            data-testid="org-tab-transcript"
          >
            <ScrollText className="mr-1 h-4 w-4" /> Transcript
          </Button>
        </div>
      </div>

      {audioUrl && (
        <audio controls src={audioUrl} className="mt-4 w-full" data-testid="org-audio-player" />
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        {/* Action items above transcript on mobile */}
        <div className="lg:hidden">
          <ActionItemsSidebar
            items={detail.actionItems}
            recordingId={isOwner ? detail.id : undefined}
            defaultCollapsed
          />
        </div>
        <Card className="flex h-[calc(100vh-14rem)] min-h-[60vh] flex-col overflow-hidden lg:h-[calc(100vh-14rem)]">
          <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
            {tab === "chat" ? (
              <ChatWindow recordingId={detail.id} apiPrefix={chatApiPrefix} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="org-transcript-scroll">
                <TranscriptPanel
                  segments={detail.segments}
                  speakers={detail.speakers}
                  fullTranscript={detail.fullTranscript}
                />
              </div>
            )}
          </CardContent>
        </Card>
        {/* Action items as sidebar on desktop */}
        <div className="hidden lg:block">
          <ActionItemsSidebar
            items={detail.actionItems}
            recordingId={isOwner ? detail.id : undefined}
          />
        </div>
      </div>
      <OrgFab orgSlug={orgSlug} isOwner={isOwner} />
    </div>
  );
}
