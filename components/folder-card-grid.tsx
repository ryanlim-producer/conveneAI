"use client";

import { FolderCard } from "@/components/folder-card";
import type { FolderData } from "@/components/folder-card";

export function FolderCardGrid({
  folders,
  onRefresh,
}: {
  folders: FolderData[];
  onRefresh?: () => void;
}) {
  if (folders.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No folders found. Try adjusting your search.
      </p>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      }}
      data-testid="folder-card-grid"
    >
      {folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} onRefresh={onRefresh} />
      ))}
    </div>
  );
}
