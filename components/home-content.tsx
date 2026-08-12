"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useRecordings } from "@/hooks/use-recordings";
import { CreationModule } from "@/components/creation-module";
import { RecordingCardGrid } from "@/components/recording-card-grid";
import { FolderCardGrid } from "@/components/folder-card-grid";
import type { FolderData } from "@/components/folder-card";
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
import { Search, LayoutGrid, List, Plus } from "lucide-react";

type ViewMode = "grid" | "list";

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border p-0.5">
      <button
        type="button"
        onClick={() => onChange("grid")}
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
        onClick={() => onChange("list")}
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
  );
}

export function HomeContent({ initialCount }: { initialCount: number }) {
  const { recordings, folders: rawFolders, loading, error, refresh } = useRecordings();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Cast folders to FolderData (the API now includes recordingCount + lastActivity)
  const folders = rawFolders as FolderData[];

  // Split recordings into ungrouped vs grouped
  const ungrouped = useMemo(() => {
    if (!recordings) return null;
    return recordings.filter((r) => !r.groupId);
  }, [recordings]);

  // Search filters
  const filteredRecordings = useMemo(() => {
    if (!recordings) return null;
    if (!search.trim()) return recordings;
    const q = search.toLowerCase();
    return recordings.filter((r) => r.filename.toLowerCase().includes(q));
  }, [recordings, search]);

  const filteredUngrouped = useMemo(() => {
    if (!ungrouped) return null;
    if (!search.trim()) return ungrouped;
    const q = search.toLowerCase();
    return ungrouped.filter((r) => r.filename.toLowerCase().includes(q));
  }, [ungrouped, search]);

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders ?? [];
    const q = search.toLowerCase();
    return (folders ?? []).filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const recordingCount = recordings?.length ?? initialCount;
  const hasUngrouped = (filteredUngrouped?.length ?? 0) > 0;
  const hasFolders = filteredFolders.length > 0;
  const hasNothing = recordingCount === 0 && (!folders || folders.length === 0);

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await fetch(api("/api/groups"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create folder");
      }
      toast.success("Folder created");
      setNewFolderOpen(false);
      setNewFolderName("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  // --- Error state ---
  if (error && !recordings) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center p-8">
        <p className="text-3xl mb-4">⚠️</p>
        <h2 className="text-lg font-semibold mb-2">Could not load recordings</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-md">{error}</p>
        <Button variant="outline" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }

  // --- Loading state ---
  if (loading && !recordings) {
    return (
      <div className="p-8">
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-9 w-36 rounded-full" />
        </div>
        <Skeleton className="mb-4 h-7 w-44" />
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

  // --- True empty state: no recordings AND no folders ---
  if (hasNothing) {
    return (
      <>
        <CreationModule count={0} />
        <div className="hidden">
          <HistoryList />
        </div>
      </>
    );
  }

  // --- List view: delegate entirely to HistoryList ---
  if (viewMode === "list") {
    return (
      <>
        <CreationModule count={recordingCount} />
        {/* Section header for list view */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">All Recordings</h2>
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
            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>
        <HistoryList />
      </>
    );
  }

  // --- Grid view: folder-first layout ---
  return (
    <>
      <CreationModule count={recordingCount} />

      {/* Ungrouped recordings section (above folders) */}
      {hasUngrouped && (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Ungrouped Recordings</h2>
          </div>
          <RecordingCardGrid
            recordings={filteredUngrouped ?? []}
            onRefresh={refresh}
          />
        </div>
      )}

      {/* Folder grid section */}
      {hasFolders && (
        <div>
          {/* Section header: Your Recordings + New Folder + search + view toggle */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your Recordings</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  setNewFolderName("");
                  setNewFolderOpen(true);
                }}
                data-testid="new-folder-button"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                New Folder
              </Button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search folders & recordings…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56 rounded-full pl-9"
                />
              </div>
              <ViewToggle viewMode={viewMode} onChange={setViewMode} />
            </div>
          </div>

          <FolderCardGrid folders={filteredFolders} onRefresh={refresh} />
        </div>
      )}

      {/* Ungrouped only, no folders */}
      {hasUngrouped && !hasFolders && (
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your Recordings</h2>
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
              <ViewToggle viewMode={viewMode} onChange={setViewMode} />
            </div>
          </div>
          <RecordingCardGrid
            recordings={filteredUngrouped ?? []}
            onRefresh={refresh}
          />
        </div>
      )}

      {/* "+ New Folder" dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Team Standups"
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                data-testid="new-folder-input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                data-testid="new-folder-save"
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
