"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRecordings } from "@/hooks/use-recordings";
import { CreationModule } from "@/components/creation-module";
import { RecordingCardGrid } from "@/components/recording-card-grid";
import { HistoryList } from "@/components/history-list";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-path";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Folder,
  Search,
  LayoutGrid,
  List,
  Pencil,
  Trash2,
} from "lucide-react";
import type { FolderData } from "@/components/folder-card";

type ViewMode = "grid" | "list";

function formatCreatedAt(sqliteUtc: string): string {
  const date = new Date(sqliteUtc.replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return sqliteUtc;
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function FolderDetailContent({ folder }: { folder: FolderData }) {
  const { recordings, loading, error, refresh } = useRecordings({
    groupId: folder.id,
  });
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(folder.name);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const recordingCount = recordings?.length ?? folder.recordingCount;

  const filtered = useMemo(() => {
    if (!recordings) return null;
    if (!search.trim()) return recordings;
    const q = search.toLowerCase();
    return recordings.filter((r) => r.filename.toLowerCase().includes(q));
  }, [recordings, search]);

  async function handleRename() {
    try {
      const res = await fetch(api(`/api/groups/${folder.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to rename");
      }
      toast.success("Folder renamed");
      setRenaming(false);
      refresh();
      // Update the URL to reflect new name is handled by the slug being the id
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(api(`/api/groups/${folder.id}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete");
      }
      toast.success("Folder deleted");
      // Navigate back to home
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  // --- Loading state ---
  if (loading && !recordings) {
    return (
      <div>
        <Skeleton className="mb-2 h-4 w-28" />
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="mt-1 h-4 w-36" />
          </div>
        </div>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error && !recordings) {
    return (
      <div>
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          All Folders
        </Link>
        <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
          <p className="text-3xl mb-4">⚠️</p>
          <h2 className="text-lg font-semibold mb-2">
            Could not load this folder
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">{error}</p>
          <Button variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Breadcrumb */}
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid="folder-breadcrumb"
      >
        <ArrowLeft className="h-3 w-3" />
        All Folders
      </Link>

      {/* Folder header */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
            <Folder className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="folder-detail-name">
              {folder.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {recordingCount}{" "}
              {recordingCount === 1 ? "recording" : "recordings"}
              {" · "}Created {formatCreatedAt(folder.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setNameDraft(folder.name);
              setRenaming(true);
            }}
            data-testid="folder-detail-rename-button"
          >
            <Pencil className="mr-1 h-4 w-4" />
            Rename
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteConfirm(true)}
            data-testid="folder-detail-delete-button"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Creation module (compact when there are recordings) */}
      <CreationModule count={recordingCount} folderId={folder.id} />

      {/* Section header + search + view toggle */}
      {recordingCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Recordings in {folder.name}
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search recordings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56 rounded-full pl-9"
              />
            </div>
            <div className="flex rounded-lg border border-border p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  viewMode === "grid"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  viewMode === "list"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty folder state */}
      {recordingCount === 0 && (
        <div
          className="flex min-h-[30vh] flex-col items-center justify-center text-center"
          data-testid="folder-detail-empty"
        >
          <p className="text-3xl mb-4">📁</p>
          <h2 className="text-lg font-semibold mb-1">No recordings yet</h2>
          <p className="text-sm text-muted-foreground">
            Upload a recording to get started — it will appear here.
          </p>
        </div>
      )}

      {/* Recording grid/list */}
      {recordingCount > 0 &&
        (viewMode === "grid" ? (
          <RecordingCardGrid
            recordings={filtered ?? []}
            onRefresh={refresh}
          />
        ) : (
          <HistoryList />
        ))}

      {/* Rename dialog */}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="folder-detail-rename-input">Name</Label>
              <Input
                id="folder-detail-rename-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                data-testid="folder-detail-rename-input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRename}
                disabled={!nameDraft.trim()}
                data-testid="folder-detail-rename-save"
              >
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
            <DialogTitle>Delete folder?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {recordingCount > 0
              ? `This will permanently delete the folder "${folder.name}" and ${recordingCount} recording${recordingCount !== 1 ? "s" : ""} will become ungrouped.`
              : `Delete the empty folder "${folder.name}"?`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="folder-detail-delete-confirm"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
