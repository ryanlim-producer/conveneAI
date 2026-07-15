"use client";

import { api } from "@/lib/api-path";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Folder,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
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
  groupId: string | null;
  groupName: string | null;
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

interface FolderInfo {
  id: string;
  name: string;
}

export function HistoryList() {
  const [recordings, setRecordings] = useState<HistoryRecording[] | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // inline editors: which recording is being renamed / re-grouped, and drafts
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [groupingId, setGroupingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"alpha-asc" | "alpha-desc" | "newest" | "most">("alpha-asc");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingGroupKey, setRenamingGroupKey] = useState<string | null>(null);
  const [groupRenameDraft, setGroupRenameDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Pointer-events drag (works for both mouse and touch, unlike HTML5 DnD)
  const pointerDrag = useRef<{
    id: string;
    label: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    active: boolean;
    raf: number | null;
  } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api("/api/history"));
      // Folder list is best-effort and must never block or fail the page
      void Promise.resolve(fetch(api("/api/groups")))
        .then(async (groupsRes) => {
          if (!groupsRes?.ok) return;
          const groupsData = await groupsRes.json().catch(() => null);
          if (Array.isArray(groupsData?.groups)) setFolders(groupsData.groups);
        })
        .catch(() => {});
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
    const names = new Map<string, string>();
    const idKeys = new Set<string>();
    // Always render Ungrouped so it stays available as a drop target
    map.set(UNGROUPED, []);
    // Seed with known folders so empty ones render (and act as drop targets)
    for (const folder of folders) {
      map.set(folder.id, []);
      names.set(folder.id, folder.name);
      idKeys.add(folder.id);
    }
    for (const rec of recordings ?? []) {
      const key = rec.groupId || rec.group?.trim() || UNGROUPED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(rec);
      if (key !== UNGROUPED && !names.has(key)) {
        names.set(key, rec.groupName || rec.group || key);
      }
      if (rec.groupId === key) idKeys.add(key);
    }
    const namedKeys = [...map.keys()].filter((k) => k !== UNGROUPED);

    // Apply sort
    namedKeys.sort((a, b) => {
      const nameA = (names.get(a) || a).toLowerCase();
      const nameB = (names.get(b) || b).toLowerCase();
      const countA = map.get(a)!.length;
      const countB = map.get(b)!.length;
      switch (sortBy) {
        case "alpha-desc":
          return nameB.localeCompare(nameA);
        case "newest":
          return b.localeCompare(a); // approximate by key (groupId)
        case "most":
          return countB - countA || nameA.localeCompare(nameB);
        default: // alpha-asc
          return nameA.localeCompare(nameB);
      }
    });

    return [...namedKeys, UNGROUPED].map((key) => ({
      key,
      name: key === UNGROUPED ? null : names.get(key) || key,
      groupId: idKeys.has(key) ? key : null,
      recordings: map.get(key)!,
    }));
  }, [recordings, folders, sortBy]);

  const existingGroups = useMemo(
    () =>
      [...new Set((recordings ?? []).map((r) => r.group?.trim()).filter(Boolean))] as string[],
    [recordings],
  );

  async function patchRecording(id: string, body: Record<string, unknown>) {
    const res = await fetch(api(`/api/history/${id}`), {
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

  async function moveRecording(
    recId: string,
    target: { key: string; name: string | null; groupId: string | null },
  ) {
    const rec = recordings?.find((r) => r.id === recId);
    if (!rec) return;
    const currentKey = rec.groupId || rec.group?.trim() || UNGROUPED;
    if (currentKey === target.key) return;

    const body =
      target.key === UNGROUPED
        ? { groupId: null }
        : target.groupId
          ? { groupId: target.groupId }
          : { group: target.name };

    if (await patchRecording(recId, body)) {
      const ungrouped = target.key === UNGROUPED;
      setRecordings(
        (prev) =>
          prev?.map((r) =>
            r.id === recId
              ? {
                  ...r,
                  groupId: ungrouped ? null : target.groupId,
                  group: ungrouped ? null : target.name,
                  groupName: ungrouped ? null : target.name,
                }
              : r,
          ) ?? null,
      );
      toast.success(ungrouped ? "Moved to Ungrouped" : `Moved to "${target.name}"`);
    }
  }

  function dropKeyAt(x: number, y: number): string | null {
    // Ghost is pointer-events-none, so this sees the element underneath it
    const el =
      typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
    return el?.closest?.("[data-drop-key]")?.getAttribute("data-drop-key") ?? null;
  }

  function positionGhost(x: number, y: number) {
    if (ghostRef.current) {
      ghostRef.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    }
  }

  function startAutoScroll() {
    // Keep scrolling while the pointer hovers near a viewport edge, so
    // off-screen folders are reachable mid-drag (essential on mobile)
    const step = () => {
      const d = pointerDrag.current;
      if (!d || !d.active) return;
      const margin = 80;
      if (d.lastY < margin) {
        window.scrollBy(0, -Math.min(24, (margin - d.lastY) / 4 + 4));
      } else if (d.lastY > window.innerHeight - margin) {
        window.scrollBy(0, Math.min(24, (d.lastY - (window.innerHeight - margin)) / 4 + 4));
      }
      d.raf = requestAnimationFrame(step);
    };
    const d = pointerDrag.current;
    if (d) d.raf = requestAnimationFrame(step);
  }

  function handleDragPointerDown(e: React.PointerEvent<HTMLDivElement>, rec: HistoryRecording) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is an optimization; the drag still works without it
      }
    }
    pointerDrag.current = {
      id: rec.id,
      label: rec.filename,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: false,
      raf: null,
    };
  }

  function handleDragPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = pointerDrag.current;
    if (!d) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (!d.active) {
      // Small threshold so a plain tap on the grip doesn't start a drag
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
      d.active = true;
      setDraggingId(d.id);
      startAutoScroll();
    }
    positionGhost(e.clientX, e.clientY);
    setDragOverKey(dropKeyAt(e.clientX, e.clientY));
  }

  function handleDragPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = pointerDrag.current;
    pointerDrag.current = null;
    if (!d) return;
    if (d.raf != null) cancelAnimationFrame(d.raf);
    if (!d.active) return;
    setDraggingId(null);
    setDragOverKey(null);
    if (e.type === "pointerup") {
      const key = dropKeyAt(e.clientX, e.clientY);
      const target = key ? groups.find((g) => g.key === key) : null;
      if (target) moveRecording(d.id, target);
    }
  }

  async function copyTranscript(id: string) {
    try {
      const res = await fetch(api(`/api/history/${id}`));
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
      const res = await fetch(api(`/api/history/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setRecordings((prev) => prev?.filter((r) => r.id !== id) ?? null);
      toast.success("Recording deleted");
    } catch {
      toast.error("Failed to delete recording");
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await fetch(api("/api/groups"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Could not create folder.");
        return;
      }
      toast.success(`Folder "${name}" created`);
      setNewFolderOpen(false);
      setNewFolderName("");
      load(); // refresh to get the new group in the list
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  async function renameGroup(groupKey: string, currentName: string) {
    const name = groupRenameDraft.trim();
    if (!name || name === currentName) {
      setRenamingGroupKey(null);
      return;
    }
    try {
      const res = await fetch(api(`/api/groups/${groupKey}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Could not rename folder.");
        return;
      }
      toast.success(`Folder renamed to "${name}"`);
      setRenamingGroupKey(null);
      load();
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  async function deleteGroup(groupKey: string, groupName: string) {
    if (!confirm(`Delete folder "${groupName}"? All recordings in it will move to Ungrouped.`)) return;
    try {
      const res = await fetch(api(`/api/groups/${groupKey}`), { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Could not delete folder.");
        return;
      }
      toast.success(`Folder "${groupName}" deleted`);
      load();
    } catch {
      toast.error("Could not reach the server.");
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewFolderOpen(true)}
            data-testid="new-folder-button"
          >
            <Plus className="mr-1 h-4 w-4" /> New Folder
          </Button>
          <DropdownMenu
            trigger={
              <Button variant="outline" size="sm" title="Sort folders" data-testid="sort-dropdown">
                <ArrowUpDown className="mr-1 h-4 w-4" /> Sort
              </Button>
            }
          >
            <DropdownItem
              onClick={() => setSortBy("alpha-asc")}
              data-testid="sort-alpha-asc"
            >
              A–Z {sortBy === "alpha-asc" && "✓"}
            </DropdownItem>
            <DropdownItem
              onClick={() => setSortBy("alpha-desc")}
              data-testid="sort-alpha-desc"
            >
              Z–A {sortBy === "alpha-desc" && "✓"}
            </DropdownItem>
            <DropdownItem
              onClick={() => setSortBy("newest")}
              data-testid="sort-newest"
            >
              Newest first {sortBy === "newest" && "✓"}
            </DropdownItem>
            <DropdownItem
              onClick={() => setSortBy("most")}
              data-testid="sort-most"
            >
              Most recordings {sortBy === "most" && "✓"}
            </DropdownItem>
          </DropdownMenu>
        </div>
        <Button variant="outline" size="sm" asChild data-testid="export-all">
          <a href={api("/api/export")} download>
            <Download className="mr-1 h-4 w-4" /> Export all (JSON)
          </a>
        </Button>
      </div>

      <datalist id="group-names">
        {existingGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      {groups.map((section) => {
        const isCollapsed = collapsedGroups.has(section.key);

        return (
        <section
          key={section.key}
          className={cn(
            "mb-6 rounded-lg transition-colors",
            draggingId && dragOverKey === section.key && "bg-accent/60 ring-2 ring-ring/50",
          )}
          data-drop-key={section.key}
          data-testid={`drop-section-${section.name ?? "ungrouped"}`}
        >
          {section.name !== null ? (
            <div className="mb-2 flex items-center gap-1">
              {renamingGroupKey === section.key ? (
                <form
                  className="flex flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    renameGroup(section.key, section.name!);
                  }}
                >
                  <Input
                    autoFocus
                    value={groupRenameDraft}
                    onChange={(e) => setGroupRenameDraft(e.target.value)}
                    className="h-7 text-sm"
                    data-testid={`group-rename-input-${section.name}`}
                  />
                  <Button type="submit" size="sm" variant="ghost" data-testid={`group-rename-save-${section.name}`}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </form>
              ) : (
                <>
                  <button
                    className="flex flex-1 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() =>
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(section.key)) next.delete(section.key);
                        else next.add(section.key);
                        return next;
                      })
                    }
                    data-testid={`group-toggle-${section.name}`}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <Folder className="h-3.5 w-3.5" /> {section.name}
                    <Badge variant="secondary" className="text-xs">
                      {section.recordings.length}
                    </Badge>
                  </button>
                  <DropdownMenu
                    trigger={
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" data-testid={`folder-kebab-${section.name}`}>
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    }
                  >
                    <DropdownItem
                      onClick={() => {
                        setGroupRenameDraft(section.name!);
                        setRenamingGroupKey(section.key);
                      }}
                      data-testid={`folder-rename-${section.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Rename folder
                    </DropdownItem>
                    <DropdownItem
                      onClick={() => deleteGroup(section.key, section.name!)}
                      danger
                      data-testid={`folder-delete-${section.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete folder
                    </DropdownItem>
                  </DropdownMenu>
                </>
              )}
            </div>
          ) : (
            <button
              className="group mb-2 flex w-full items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
              onClick={() =>
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(UNGROUPED)) next.delete(UNGROUPED);
                  else next.add(UNGROUPED);
                  return next;
                })
              }
              data-testid="group-toggle-ungrouped"
              aria-expanded={!collapsedGroups.has(UNGROUPED)}
            >
              {collapsedGroups.has(UNGROUPED) ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              Ungrouped
            </button>
          )}

          {!isCollapsed && (
            <div className="space-y-3">
              {section.recordings.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-6 text-center text-sm text-muted-foreground">
                    No recordings here — drag recordings here or use <strong>Move to folder</strong>.
                  </CardContent>
                </Card>
              ) : (
                section.recordings.map((rec) => {

              const source = SOURCE_META[rec.source] ?? SOURCE_META.web_upload;
              return (
                <Card
                  key={rec.id}
                  className={cn(
                    "transition-colors hover:bg-accent/40",
                    draggingId === rec.id && "opacity-50",
                  )}
                >
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
                    <div className="flex shrink-0 gap-0.5">
                      <div
                        className="flex cursor-grab touch-none select-none items-center px-0.5 text-muted-foreground [-webkit-touch-callout:none] hover:text-foreground active:cursor-grabbing"
                        title="Drag to move to a folder"
                        data-testid={`drag-handle-${rec.id}`}
                        onPointerDown={(e) => handleDragPointerDown(e, rec)}
                        onPointerMove={handleDragPointerMove}
                        onPointerUp={handleDragPointerEnd}
                        onPointerCancel={handleDragPointerEnd}
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <DropdownMenu
                        trigger={
                          <Button variant="ghost" size="sm" title="More actions" data-testid={`kebab-${rec.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      >
                        <DropdownItem
                          onClick={() => {
                            setGroupingId(null);
                            setDraft(rec.filename);
                            setRenamingId(rec.id);
                          }}
                          data-testid={`kebab-rename-${rec.id}`}
                        >
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownItem>
                        <DropdownItem
                          onClick={() => {
                            setRenamingId(null);
                            setDraft(rec.groupId ?? "");
                            setGroupingId(rec.id);
                          }}
                          data-testid={`kebab-move-${rec.id}`}
                        >
                          <Folder className="h-4 w-4" /> Move to folder
                        </DropdownItem>
                        <DropdownItem
                          onClick={() => copyTranscript(rec.id)}
                          data-testid={`kebab-copy-${rec.id}`}
                        >
                          <Copy className="h-4 w-4" /> Copy transcript
                        </DropdownItem>
                        <DropdownItem
                          onClick={() => deleteRecording(rec.id)}
                          danger
                          data-testid={`kebab-delete-${rec.id}`}
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownItem>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              );
            }))}
            </div>
          )}
        </section>
        );
      })}

      {draggingId && (
        <div
          ref={(el) => {
            ghostRef.current = el;
            // Position immediately on mount so the ghost doesn't flash at 0,0
            const d = pointerDrag.current;
            if (el && d) positionGhost(d.lastX, d.lastY);
          }}
          className="pointer-events-none fixed left-0 top-0 z-50 max-w-[240px] truncate rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-lg"
          data-testid="drag-ghost"
        >
          {pointerDrag.current?.label}
        </div>
      )}

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createFolder();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Standups, Client X, Design Reviews"
                data-testid="new-folder-input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setNewFolderOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newFolderName.trim()} data-testid="new-folder-create">
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
