"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Plus, X, Check } from "lucide-react";

export interface BoardColumn {
  id: string;
  name: string;
  builtin: boolean;
}

export function OrgKanbanBoard({
  columns,
  isOwner,
  onAddColumn,
  renderColumn,
}: {
  columns: BoardColumn[];
  isOwner: boolean;
  onAddColumn: (name: string) => Promise<void>;
  renderColumn: (column: BoardColumn) => ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitNewColumn() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onAddColumn(newName.trim());
      setNewName("");
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  const hasMoreThanOneColumn = columns.length + (isOwner ? 1 : 0) > 1;

  return (
    <div className="relative">
    <ScrollArea className="w-full" data-testid="org-kanban-board">
      <div className="flex gap-4 pb-4">
        {columns.map((column) => (
          <div key={column.id} className="w-80 shrink-0" data-testid={`org-kanban-column-${column.id}`}>
            <Card className="h-full">
              <CardHeader className="flex-row items-center justify-between py-3">
                <h3 className="font-medium text-sm">{column.name}</h3>
              </CardHeader>
              <CardContent className="pt-0">{renderColumn(column)}</CardContent>
            </Card>
          </div>
        ))}

        {isOwner && (
          <div className="w-80 shrink-0" data-testid="org-kanban-add-column">
            {adding ? (
              <Card>
                <CardContent className="space-y-2 py-3">
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitNewColumn(); }}
                    placeholder="Column name"
                    data-testid="org-kanban-new-column-input"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setNewName(""); }}>
                      <X className="mr-1 h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button size="sm" onClick={submitNewColumn} disabled={saving || !newName.trim()} data-testid="org-kanban-save-column">
                      {saving ? "Adding…" : <><Check className="mr-1 h-3.5 w-3.5" /> Add</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Button
                variant="outline"
                className="h-full min-h-[4rem] w-full border-dashed"
                onClick={() => setAdding(true)}
                data-testid="org-kanban-add-column-button"
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add column
              </Button>
            )}
          </div>
        )}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
    {hasMoreThanOneColumn && (
      <div className="pointer-events-none absolute right-0 top-0 bottom-4 w-10 bg-gradient-to-l from-background to-transparent" />
    )}
    </div>
  );
}
