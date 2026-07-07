"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronUp,
  ListTodo,
  User,
  CalendarClock,
  Plus,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";

export interface ActionItem {
  task: string;
  assignee: string;
  deadline: string;
  context: string;
}

const EMPTY_ITEM: ActionItem = { task: "", assignee: "", deadline: "", context: "" };

function ItemEditor({
  item,
  onChange,
}: {
  item: ActionItem;
  onChange: (item: ActionItem) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid="action-item-editor">
      <Input
        value={item.task}
        placeholder="Task"
        autoFocus
        onChange={(e) => onChange({ ...item, task: e.target.value })}
        data-testid="edit-task"
      />
      <div className="flex gap-1.5">
        <Input
          value={item.assignee}
          placeholder="Assignee"
          onChange={(e) => onChange({ ...item, assignee: e.target.value })}
          data-testid="edit-assignee"
        />
        <Input
          value={item.deadline}
          placeholder="Deadline"
          onChange={(e) => onChange({ ...item, deadline: e.target.value })}
          data-testid="edit-deadline"
        />
      </div>
    </div>
  );
}

export function ActionItemsSidebar({
  items: initialItems,
  recordingId,
}: {
  items: ActionItem[];
  recordingId?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [items, setItems] = useState<ActionItem[]>(initialItems);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const editable = Boolean(recordingId);

  function update(next: ActionItem[], stillEditing: number | null = null) {
    setItems(next);
    setEditingIndex(stillEditing);
    setDirty(true);
  }

  async function save() {
    if (!recordingId) return;
    const cleaned = items.filter((i) => i.task.trim());
    setSaving(true);
    try {
      const res = await fetch(`/api/history/${recordingId}/actions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionItems: cleaned }),
      });
      if (!res.ok) {
        toast.error((await res.json()).error || "Could not save action items.");
        return;
      }
      setItems(cleaned);
      setEditingIndex(null);
      setDirty(false);
      toast.success("Action items saved");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="self-start rounded-lg border bg-card p-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto"
      data-testid="action-items-sidebar"
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="h-4 w-4" />
          Action items
          <Badge variant="secondary">{items.length}</Badge>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
          data-testid="action-items-toggle"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (
        <>
          {items.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground" data-testid="action-items-empty">
              No action items detected in this meeting.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {items.map((item, i) => (
                <li key={i} className="group rounded-md border p-3 text-sm" data-testid="action-item">
                  {editingIndex === i ? (
                    <ItemEditor
                      item={item}
                      onChange={(next) => update(items.map((it, j) => (j === i ? next : it)), i)}
                    />
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{item.task}</p>
                        {editable && (
                          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              title="Edit"
                              onClick={() => setEditingIndex(i)}
                              data-testid="action-item-edit"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              title="Remove"
                              onClick={() => update(items.filter((_, j) => j !== i))}
                              data-testid="action-item-delete"
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {item.assignee && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {item.assignee}
                          </span>
                        )}
                        {item.deadline && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" /> {item.deadline}
                          </span>
                        )}
                      </div>
                      {item.context && (
                        <p className="mt-1.5 text-xs text-muted-foreground">{item.context}</p>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editable && (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => update([...items, { ...EMPTY_ITEM }], items.length)}
                data-testid="action-item-add"
              >
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
              {dirty && (
                <Button size="sm" onClick={save} disabled={saving} data-testid="action-items-save">
                  <Check className="mr-1 h-3 w-3" />
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
