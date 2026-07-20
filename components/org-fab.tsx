"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ListTodo, MessageSquare, Folder, Settings, Plus, X } from "lucide-react";

type OrgTab = "actions" | "chats" | "recordings";

interface OrgFabProps {
  orgSlug: string;
  isOwner: boolean;
  /** When provided, switches tabs in place instead of navigating (used on the org workspace page itself). */
  onNavigate?: (tab: OrgTab) => void;
}

export function OrgFab({ orgSlug, isOwner, onNavigate }: OrgFabProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2" data-testid="org-fab">
      {open && (
        <div className="flex flex-col items-end gap-2" data-testid="org-fab-menu">
          {isOwner && (
            <Button
              size="sm"
              variant="secondary"
              className="shadow-md"
              asChild
              data-testid="org-fab-manage"
            >
              <Link href={`/org/${orgSlug}/manage`} onClick={() => setOpen(false)}>
                <Settings className="mr-1.5 h-4 w-4" /> Manage
              </Link>
            </Button>
          )}
          {onNavigate ? (
            <>
              <Button size="sm" variant="secondary" className="shadow-md" data-testid="org-fab-recordings"
                onClick={() => { onNavigate("recordings"); setOpen(false); }}>
                <Folder className="mr-1.5 h-4 w-4" /> Recordings
              </Button>
              <Button size="sm" variant="secondary" className="shadow-md" data-testid="org-fab-chats"
                onClick={() => { onNavigate("chats"); setOpen(false); }}>
                <MessageSquare className="mr-1.5 h-4 w-4" /> Recent Chats
              </Button>
              <Button size="sm" variant="secondary" className="shadow-md" data-testid="org-fab-actions"
                onClick={() => { onNavigate("actions"); setOpen(false); }}>
                <ListTodo className="mr-1.5 h-4 w-4" /> Action Items
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" className="shadow-md" asChild data-testid="org-fab-recordings">
                <Link href={`/org/${orgSlug}#recordings`} onClick={() => setOpen(false)}>
                  <Folder className="mr-1.5 h-4 w-4" /> Recordings
                </Link>
              </Button>
              <Button size="sm" variant="secondary" className="shadow-md" asChild data-testid="org-fab-chats">
                <Link href={`/org/${orgSlug}#chats`} onClick={() => setOpen(false)}>
                  <MessageSquare className="mr-1.5 h-4 w-4" /> Recent Chats
                </Link>
              </Button>
              <Button size="sm" variant="secondary" className="shadow-md" asChild data-testid="org-fab-actions">
                <Link href={`/org/${orgSlug}#actions`} onClick={() => setOpen(false)}>
                  <ListTodo className="mr-1.5 h-4 w-4" /> Action Items
                </Link>
              </Button>
            </>
          )}
        </div>
      )}
      <Button
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close navigation" : "Open navigation"}
        data-testid="org-fab-trigger"
      >
        {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
      </Button>
    </div>
  );
}
