"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  Copy,
  Download,
  Folder,
  Pencil,
  Trash2,
  Users,
  Clock,
  ListTodo,
  RefreshCw,
} from "lucide-react";

export interface HistoryRecording {
  id: string;
  filename: string;
  source: "desktop" | "telegram" | "web_upload";
  durationSeconds: number | null;
  speakerCount: number;
  actionItemCount: number;
  group: string | null;
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
  return date.toLocaleString("en-US", {
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

const UNGROUPED = "__ungrouped__";

export function HistoryList() {
  const [recordings, setRecordings] = useState<HistoryRecording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // inline editors: which recording is being renamed / re-grouped, and drafts
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [groupingId, setGroupingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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

  const groups = useMemo(() => {
    const map = new Map<string, HistoryRecording[]>();
    for (const rec of recordings ?? []) {
      const key = rec.group?.trim() || UNGROUPED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(rec);
    }
    // named groups alphabetically, ungrouped last
    const named = [...map.keys()].filter((k) => k !== UNGROUPED).sort();
    return [...named, ...(map.has(UNGROUPED) ? [UNGROUPED] : [])].map((key) => ({
      name: key === UNGROUPED ? null : key,
      recordings: map.get(key)!,
    }));
  }, [recordings]);

  const existingGroups = useMemo(
    () =>
      [...new Set((recordings ?? []).map((r) => r.group?.trim()).filter(Boolean))] as string[],
    [recordings],
  );

  async function patchRecording(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || "Update failed.");
      return false;
    }
    return true;
  }

  async function saveRename(rec: HistoryRecording) {
    const name = draft.trim();
    setRenamingId(null);
    if (!name || name === rec.filename) return;
    if (await patchRecording(rec.id, { filename: name })) {
      setRecordings((prev) => prev?.map((r) => (r.id === rec.id ? { ...r, filename: name } : r)) ?? null);
      toast.success("Recording renamed");
    }
  }

  async function saveGroup(rec: HistoryRecording) {
    const group = draft.trim() || null;
    setGroupingId(null);
    if ((rec.group ?? null) === group) return;
    if (await patchRecording(rec.id, { group })) {
      setRecordings((prev) => prev?.map((r) => (r.id === rec.id ? { ...r, group } : r)) ?? null);
      toast.success(group ? `Moved to "${group}"` : "Removed from group");
    }
  }

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

  if (!recordings || recordings.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-3xl">🎙</p>
          <p className="mt-2 font-medium">No recordings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Record via the desktop app, upload here, or send audio to the Telegram bot.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div data-testid="history-list">
      <div className="mb-4 flex justify-end">
        <Button variant="outline" size="sm" asChild data-testid="export-all">
          <a href="/api/export" download>
            <Download className="mr-1 h-4 w-4" /> Export all (JSON)
          </a>
        </Button>
      </div>

      <datalist id="group-names">
        {existingGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      {groups.map((section) => (
        <section key={section.name ?? UNGROUPED} className="mb-6">
          {section.name !== null ? (
            <h2
              className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"
              data-testid={`group-header-${section.name}`}
            >
              <Folder className="h-3.5 w-3.5" /> {section.name}
              <Badge variant="secondary" className="text-xs">
                {section.recordings.length}
              </Badge>
            </h2>
          ) : (
            groups.length > 1 && (
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Ungrouped</h2>
            )
          )}

          <div className="space-y-3">
            {section.recordings.map((rec) => {
              const source = SOURCE_META[rec.source] ?? SOURCE_META.web_upload;
              return (
                <Card key={rec.id} className="transition-colors hover:bg-accent/40">
                  <CardContent className="flex items-center gap-4 py-4">
                    <span className="text-2xl" title={source.label}>
                      {source.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      {renamingId === rec.id ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            saveRename(rec);
                          }}
                        >
                          <Input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="h-8"
                            data-testid="history-rename-input"
                          />
                          <Button type="submit" size="sm" variant="ghost" data-testid="history-rename-save">
                            <Check className="h-4 w-4" />
                          </Button>
                        </form>
                      ) : groupingId === rec.id ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            saveGroup(rec);
                          }}
                        >
                          <Input
                            autoFocus
                            list="group-names"
                            placeholder="Group name (empty to ungroup)"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="h-8"
                            data-testid="history-group-input"
                          />
                          <Button type="submit" size="sm" variant="ghost" data-testid="history-group-save">
                            <Check className="h-4 w-4" />
                          </Button>
                        </form>
                      ) : (
                        <Link
                          href={`/recording/${rec.id}`}
                          className="block min-w-0"
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
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Rename"
                        onClick={() => {
                          setGroupingId(null);
                          setDraft(rec.filename);
                          setRenamingId(rec.id);
                        }}
                        data-testid={`history-rename-${rec.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Move to group"
                        onClick={() => {
                          setRenamingId(null);
                          setDraft(rec.group ?? "");
                          setGroupingId(rec.id);
                        }}
                        data-testid={`history-group-${rec.id}`}
                      >
                        <Folder className="h-4 w-4" />
                      </Button>
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
        </section>
      ))}
    </div>
  );
}
