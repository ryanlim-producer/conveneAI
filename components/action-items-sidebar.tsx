"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ListTodo, User, CalendarClock } from "lucide-react";

export interface ActionItem {
  task: string;
  assignee: string;
  deadline: string;
  context: string;
}

export function ActionItemsSidebar({ items }: { items: ActionItem[] }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className="rounded-lg border bg-card p-4" data-testid="action-items-sidebar">
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
      {!collapsed &&
        (items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="action-items-empty">
            No action items detected in this meeting.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {items.map((item, i) => (
              <li key={i} className="rounded-md border p-3 text-sm" data-testid="action-item">
                <p className="font-medium">{item.task}</p>
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
              </li>
            ))}
          </ul>
        ))}
    </aside>
  );
}
