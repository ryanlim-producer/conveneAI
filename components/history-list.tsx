"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Trash2, Users, Clock, ListTodo, RefreshCw } from "lucide-react";

export interface HistoryRecording {
  id: string;
  filename: string;
  source: "desktop" | "telegram" | "web_upload";
  durationSeconds: number | null;
  speakerCount: number;
  actionItemCount: number;
  jobStatus: string | null;
  createdAt: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(sqliteUtc: string): string {
  // SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"
  const date = new Date(sqliteUtc.replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return sqliteUtc;
  return date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SOURCE_META: Record<HistoryRecording["source"], { icon: string; label: string }> = {
  desktop: { icon: "🎤", label: "Desktop" },
  telegram: { icon: "📱", label: "Telegram" },
  web_upload: { icon: "🌐", label: "Web upload" },
};

export function HistoryList() {
  const [recordings, setRecordings] = useState<HistoryRecording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/history");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setRecordings(data.recordings);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — check that the server is running and try refreshing.`
          : "Failed to load history — try refreshing.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copyTranscript(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) throw new Error("Could not load transcript");
      const detail = await res.json();
      await navigator.clipboard.writeText(detail.fullTranscript || "");
      toast.success("Transcript copied to clipboard");
    } catch {
      toast.error("Failed to copy transcript");
    }
  }

  async function deleteRecording(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setRecordings((prev) => prev?.filter((r) => r.id !== id) ?? null);
      toast.success("Recording deleted");
    } catch {
      toast.error("Failed to delete recording");
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3" data-testid="history-loading">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 py-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-4 w-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!recordings || recordings.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-3xl">🎙</p>
          <p className="mt-2 font-medium">No recordings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Record via the desktop app or send audio to the Telegram bot.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Success state
  return (
    <div className="space-y-3" data-testid="history-list">
      {recordings.map((rec) => {
        const source = SOURCE_META[rec.source] ?? SOURCE_META.web_upload;
        return (
          <Card key={rec.id} className="transition-colors hover:bg-accent/40">
            <CardContent className="flex items-center gap-4 py-4">
              <span className="text-2xl" title={source.label}>
                {source.icon}
              </span>
              <Link
                href={`/recording/${rec.id}`}
                className="min-w-0 flex-1"
                data-testid={`recording-link-${rec.id}`}
              >
                <p className="truncate font-medium">{rec.filename}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatDate(rec.createdAt)}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(rec.durationSeconds)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {rec.speakerCount} speaker{rec.speakerCount !== 1 ? "s" : ""}
                  </span>
                  {rec.actionItemCount > 0 && (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <ListTodo className="h-3 w-3" />
                      {rec.actionItemCount} action item{rec.actionItemCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </Link>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Copy transcript"
                  onClick={() => copyTranscript(rec.id)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete recording"
                  onClick={() => deleteRecording(rec.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
