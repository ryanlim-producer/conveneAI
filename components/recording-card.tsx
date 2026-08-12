"use client";

import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api-path";
import { cn } from "@/lib/utils";
import {
  Clock,
  Monitor,
  Smartphone,
  Globe,
  MoreHorizontal,
  Pencil,
  Folder,
  Trash2,
  Download,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { HistoryRecording } from "@/components/history-list";

const SOURCE_ICON: Record<
  HistoryRecording["source"],
  { Icon: React.ComponentType<{ className?: string }>; bg: string; label: string }
> = {
  desktop: { Icon: Monitor, bg: "bg-blue-100 text-blue-700", label: "Desktop" },
  telegram: { Icon: Smartphone, bg: "bg-cyan-100 text-cyan-700", label: "Telegram" },
  web_upload: { Icon: Globe, bg: "bg-gray-100 text-gray-600", label: "Web upload" },
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(sqliteUtc: string): string {
  const date = new Date(sqliteUtc.replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return sqliteUtc;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RecordingCard({
  recording,
  onRefresh,
}: {
  recording: HistoryRecording;
  onRefresh?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(recording.filename);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const source = SOURCE_ICON[recording.source] ?? SOURCE_ICON.web_upload;
  const { Icon: SourceIcon, bg: sourceBg } = source;
  const isProcessing =
    recording.jobStatus === "queued" || recording.jobStatus === "processing";
  const isError = recording.jobStatus === "error";
  const isUngrouped = !recording.groupId;

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("text/plain", recording.id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  }

  function handleDragEnd() {
    setIsDragging(false);
  }

  async function handleRename() {
    try {
      const res = await fetch(api(`/api/history/${recording.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: nameDraft }),
      });
      if (!res.ok) throw new Error();
      toast.success("Recording renamed");
      setRenaming(false);
      onRefresh?.();
    } catch {
      toast.error("Failed to rename");
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(api(`/api/history/${recording.id}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Recording deleted");
      setDeleteConfirm(false);
      onRefresh?.();
    } catch {
      toast.error("Failed to delete");
    }
  }

  return (
    <>
      <Link
        href={`/recording/${recording.id}`}
        className={cn(
          "group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
          "transition-all hover:shadow-md hover:border-muted-foreground/20",
          isUngrouped && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-50",
        )}
        data-testid={`recording-card-${recording.id}`}
        draggable={isUngrouped}
        onDragStart={isUngrouped ? handleDragStart : undefined}
        onDragEnd={isUngrouped ? handleDragEnd : undefined}
      >
        {/* Top row: source icon + status + more menu */}
        <div className="flex items-start justify-between">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              sourceBg,
            )}
          >
            <SourceIcon className="h-4 w-4" />
          </div>

          <div className="flex items-center gap-1.5">
            {/* Status pill */}
            {isProcessing && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processing
              </span>
            )}
            {isError && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                <AlertTriangle className="h-3 w-3" />
                Failed
              </span>
            )}

            {/* More menu — stop propagation so it doesn't navigate */}
            <div onClick={(e) => e.preventDefault()}>
              <DropdownMenu
                trigger={
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted cursor-pointer"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                }
              >
                <DropdownItem
                  onClick={() => {
                    setNameDraft(recording.filename);
                    setRenaming(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Rename
                </DropdownItem>
                <DropdownItem onClick={() => setGroupingOpen(true)}>
                  <Folder className="h-4 w-4" />
                  Move to folder
                </DropdownItem>
                <DropdownItem
                  onClick={() => {
                    window.open(api(`/api/history/${recording.id}/audio`), "_blank");
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download
                </DropdownItem>
                <DropdownItem danger onClick={() => setDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownItem>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Filename */}
        <h3 className="font-medium leading-snug line-clamp-2 text-sm">
          {recording.filename}
        </h3>

        {/* Metadata row */}
        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(recording.durationSeconds)}
          </span>
          <span>{formatDate(recording.createdAt)}</span>
        </div>
      </Link>

      {/* Rename dialog */}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename recording</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rename-input">Name</Label>
              <Input
                id="rename-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                data-testid="rename-input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button onClick={handleRename} data-testid="rename-save">
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recording?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete &ldquo;{recording.filename}&rdquo; and
            all its data. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move to folder dialog — simple text input, full combobox in list view */}
      <Dialog open={groupingOpen} onOpenChange={setGroupingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="folder-input">Folder name</Label>
              <Input
                id="folder-input"
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                placeholder="e.g. Team Standups"
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    try {
                      const res = await fetch(api(`/api/history/${recording.id}`), {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ group: groupDraft || null }),
                      });
                      if (!res.ok) throw new Error();
                      toast.success("Moved to folder");
                      setGroupingOpen(false);
                      onRefresh?.();
                    } catch {
                      toast.error("Failed to move");
                    }
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setGroupingOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const res = await fetch(api(`/api/history/${recording.id}`), {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ group: groupDraft || null }),
                    });
                    if (!res.ok) throw new Error();
                    toast.success("Moved to folder");
                    setGroupingOpen(false);
                    onRefresh?.();
                  } catch {
                    toast.error("Failed to move");
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
