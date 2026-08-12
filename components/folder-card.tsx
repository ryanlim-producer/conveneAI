"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-path";
import { cn } from "@/lib/utils";
import {
  Folder,
  MoreHorizontal,
  Pencil,
  Trash2,
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

export interface FolderData {
  id: string;
  name: string;
  recordingCount: number;
  lastActivity: string | null;
  createdAt: string;
}

function formatRelative(sqliteUtc: string | null): string {
  if (!sqliteUtc) return "";
  const date = new Date(sqliteUtc.replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function FolderCard({
  folder,
  onRefresh,
}: {
  folder: FolderData;
  onRefresh?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(folder.name);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only reset if we're actually leaving the card, not entering a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const recordingId = e.dataTransfer.getData("text/plain");
    if (!recordingId) return;

    try {
      const res = await fetch(api(`/api/history/${recordingId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: folder.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to move recording");
      }
      toast.success(`Moved to "${folder.name}"`);
      onRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move recording");
    }
  }

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
      onRefresh?.();
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
      const data = await res.json();
      toast.success(
        data.ungroupedCount > 0
          ? `Folder deleted. ${data.ungroupedCount} recording${data.ungroupedCount !== 1 ? "s" : ""} ungrouped.`
          : "Folder deleted",
      );
      setDeleteConfirm(false);
      onRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <>
      <Link
        href={`/folder/${folder.id}`}
        className={cn(
          "group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
          "transition-all hover:shadow-md hover:border-muted-foreground/20",
          dragOver && "border-amber-400 bg-amber-50 ring-2 ring-amber-200",
        )}
        data-testid={`folder-card-${folder.id}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Top row: amber folder icon + more menu */}
        <div className="flex items-start justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Folder className="h-4 w-4" />
          </div>

          {/* More menu — stop propagation so it doesn't navigate */}
          <div onClick={(e) => e.preventDefault()}>
            <DropdownMenu
              trigger={
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted cursor-pointer"
                  aria-label="Folder actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
            >
              <DropdownItem
                onClick={() => {
                  setNameDraft(folder.name);
                  setRenaming(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                Rename
              </DropdownItem>
              <DropdownItem
                danger
                onClick={() => setDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownItem>
            </DropdownMenu>
          </div>
        </div>

        {/* Folder name */}
        <h3 className="font-medium leading-snug line-clamp-2 text-sm">
          {folder.name}
        </h3>

        {/* Metadata row */}
        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {folder.recordingCount}{" "}
            {folder.recordingCount === 1 ? "recording" : "recordings"}
          </span>
          {folder.lastActivity && (
            <span>Updated {formatRelative(folder.lastActivity)}</span>
          )}
        </div>
      </Link>

      {/* Rename dialog */}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="folder-rename-input">Name</Label>
              <Input
                id="folder-rename-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                data-testid="folder-rename-input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRename}
                disabled={!nameDraft.trim()}
                data-testid="folder-rename-save"
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
            {folder.recordingCount > 0
              ? `This will permanently delete the folder "${folder.name}" and ${folder.recordingCount} recording${folder.recordingCount !== 1 ? "s" : ""} will become ungrouped.`
              : `Delete the empty folder "${folder.name}"?`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="folder-delete-confirm"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
