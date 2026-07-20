"use client";

import { api } from "@/lib/api-path";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ListTodo, Folder, ArrowLeft, Settings,
  User, CalendarClock, Clock, Users, RefreshCw, Shield,
  Pencil, Trash2, Check, X, MessageSquare, CalendarDays,
  ChevronDown, ChevronRight, LayoutGrid,
} from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { OrgFab } from "@/components/org-fab";

interface FolderData {
  id: string;
  name: string;
  recordings: {
    id: string;
    filename: string;
    source: string;
    durationSeconds: number | null;
    speakerCount: number;
    actionItemCount: number;
    createdAt: string;
  }[];
}

interface ActionItemEntry {
  task: string;
  assignee: string;
  deadline: string;
  context: string;
  completed: boolean;
  recordingId: string;
  recordingFilename: string;
  recordingCreatedAt: string;
  itemIndex: number;
}

interface ActionItemFolder {
  folderId: string;
  folderName: string;
  items: ActionItemEntry[];
}

interface RecordingGroup {
  recordingId: string;
  recordingFilename: string;
  recordingCreatedAt: string;
  items: ActionItemEntry[];
}

interface RecentChat {
  recordingId: string;
  recordingFilename: string;
  recordingCreatedAt: string;
  lastMessage: string;
  lastChatAt: string;
}

function formatMeetingDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (isYesterday) return `Yesterday, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function groupByRecording(items: ActionItemEntry[]): RecordingGroup[] {
  const map = new Map<string, RecordingGroup>();
  for (const item of items) {
    let group = map.get(item.recordingId);
    if (!group) {
      group = {
        recordingId: item.recordingId,
        recordingFilename: item.recordingFilename,
        recordingCreatedAt: item.recordingCreatedAt,
        items: [],
      };
      map.set(item.recordingId, group);
    }
    group.items.push(item);
  }
  return [...map.values()].sort((a, b) => b.recordingCreatedAt.localeCompare(a.recordingCreatedAt));
}

const ALL_FOLDERS_TAB = "__all__";

export function OrgWorkspace({
  orgId, orgName, orgSlug, isOwner, memberId,
}: {
  orgId: string;
  orgName: string;
  orgSlug: string;
  isOwner: boolean;
  memberId?: string;
}) {
  const [view, setView] = useState<"actions" | "chats" | "recordings">("actions");
  const [actionItems, setActionItems] = useState<ActionItemFolder[] | null>(null);
  const [folders, setFolders] = useState<FolderData[] | null>(null);
  const [recentChats, setRecentChats] = useState<RecentChat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<string>(ALL_FOLDERS_TAB);
  const [activeRecordingsFolderId, setActiveRecordingsFolderId] = useState<string>(ALL_FOLDERS_TAB);
  const [editingKey, setEditingKey] = useState<string | null>(null); // `${folderId}:${itemIdx}`
  const [editDraft, setEditDraft] = useState<{ task: string; assignee: string; deadline: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [collapsedRecordings, setCollapsedRecordings] = useState<Set<string>>(new Set());
  const eventsRef = useRef<EventSource | null>(null);

  // Jump to a tab via URL hash (e.g. /org/slug#chats) — used by the FAB for deep links.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "actions" || hash === "chats" || hash === "recordings") {
      setView(hash);
    }
  }, []);

  useEffect(() => {
    load();
    // SSE connection
    const url = api(`/api/org/${orgId}/events`);
    eventsRef.current = new EventSource(url);
    eventsRef.current.onmessage = (e) => {
      try {
        const snapshot = JSON.parse(e.data);
        if (memberId && !snapshot.memberIds?.includes(memberId)) {
          eventsRef.current?.close();
          toast.error("You have been removed from this organization.");
          // Clear cookie + redirect
          fetch(api("/api/org/auth/logout"), { method: "POST" }).then(() => {
            window.location.reload();
          });
          return;
        }
        // Refresh data on any change
        load();
      } catch {}
    };
    // Re-fetch periodically even without SSE events
    const interval = setInterval(load, 10000);
    return () => {
      eventsRef.current?.close();
      clearInterval(interval);
    };
  }, [orgId, memberId]);

  async function load() {
    try {
      const [aiRes, fRes, rcRes] = await Promise.all([
        fetch(api(`/api/org/${orgId}/action-items`)),
        fetch(api(`/api/org/${orgId}/folders`)),
        fetch(api(`/api/org/${orgId}/recent-chats`)),
      ]);
      if (aiRes.ok) setActionItems((await aiRes.json()).folders);
      if (fRes.ok) setFolders((await fRes.json()).folders);
      if (rcRes.ok) setRecentChats((await rcRes.json()).chats);
    } catch {} finally {
      setLoading(false);
    }
  }

  // Build the list of all action items for one recording (across the whole org),
  // needed because PATCH replaces the recording's full action_items_json.
  function getRecordingItems(recordingId: string): ActionItemEntry[] {
    if (!actionItems) return [];
    return actionItems.flatMap((f) => f.items.filter((it) => it.recordingId === recordingId));
  }

  function startEdit(key: string, item: ActionItemEntry) {
    setEditingKey(key);
    setEditDraft({ task: item.task, assignee: item.assignee, deadline: item.deadline });
  }

  function cancelEdit() { setEditingKey(null); setEditDraft(null); }

  async function saveEdit(key: string, item: ActionItemEntry) {
    if (!editDraft || !editDraft.task.trim()) return;

    const allItems = getRecordingItems(item.recordingId);
    const localIdx = allItems.findIndex((it) => it === item);
    if (localIdx === -1) return;

    const updated = allItems.map((it, i) =>
      i === localIdx
        ? { ...it, task: editDraft.task.trim(), assignee: editDraft.assignee.trim(), deadline: editDraft.deadline.trim() }
        : it
    );

    setSaving(true);
    try {
      const res = await fetch(api(`/api/org/${orgId}/action-items`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: item.recordingId, actionItems: updated }),
      });
      if (res.ok) {
        toast.success("Action item updated.");
        cancelEdit();
        load();
      } else {
        toast.error((await res.json().catch(() => ({}))).error || "Could not save.");
      }
    } catch { toast.error("Could not reach the server."); } finally { setSaving(false); }
  }

  function toggleRecordingCollapsed(recordingId: string) {
    setCollapsedRecordings((prev) => {
      const next = new Set(prev);
      if (next.has(recordingId)) next.delete(recordingId); else next.add(recordingId);
      return next;
    });
  }

  async function toggleCompleted(item: ActionItemEntry) {
    // Optimistic UI: flip locally, then confirm with the server.
    const nextCompleted = !item.completed;
    setActionItems((prev) =>
      prev
        ? prev.map((f) => ({
            ...f,
            items: f.items.map((it) =>
              it.recordingId === item.recordingId && it.itemIndex === item.itemIndex
                ? { ...it, completed: nextCompleted }
                : it
            ),
          }))
        : prev
    );
    try {
      const res = await fetch(api(`/api/org/${orgId}/action-items/toggle`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: item.recordingId, itemIndex: item.itemIndex, completed: nextCompleted }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Could not update. Reverting.");
      load();
    }
  }

  async function deleteItem(item: ActionItemEntry) {
    const allItems = getRecordingItems(item.recordingId);
    const localIdx = allItems.findIndex((it) => it === item);
    if (localIdx === -1) return;

    const updated = allItems.filter((_, i) => i !== localIdx);

    try {
      const res = await fetch(api(`/api/org/${orgId}/action-items`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: item.recordingId, actionItems: updated }),
      });
      if (res.ok) {
        toast.success("Action item deleted.");
        load();
      } else {
        toast.error((await res.json().catch(() => ({}))).error || "Could not delete.");
      }
    } catch { toast.error("Could not reach the server."); }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8" data-testid="org-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/organizations"><ArrowLeft className="h-4 w-4" /> Back</Link>
              </Button>
            )}
          </div>
          <h1 className="text-2xl font-semibold mt-1">
            {orgName}
            {isOwner && (
              <Badge variant="outline" className="ml-2 align-middle gap-1" data-testid="org-owner-badge">
                <Shield className="h-3 w-3" /> Owner
              </Badge>
            )}
          </h1>
        </div>
        {isOwner && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/org/${orgSlug}/manage`} data-testid="org-manage-button">
              <Settings className="mr-1 h-4 w-4" /> Manage
            </Link>
          </Button>
        )}
      </div>

      <div className="flex gap-2 mb-6" role="tablist">
        <Button variant={view === "actions" ? "secondary" : "ghost"} size="sm" onClick={() => setView("actions")} data-testid="org-tab-actions">
          <ListTodo className="mr-1 h-4 w-4" /> Action Items
        </Button>
        <Button variant={view === "chats" ? "secondary" : "ghost"} size="sm" onClick={() => setView("chats")} data-testid="org-tab-chats">
          <MessageSquare className="mr-1 h-4 w-4" /> Recent Chats
        </Button>
        <Button variant={view === "recordings" ? "secondary" : "ghost"} size="sm" onClick={() => setView("recordings")} data-testid="org-tab-recordings">
          <Folder className="mr-1 h-4 w-4" /> Recordings
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3" data-testid="org-loading">
          {[0, 1].map((i) => <Card key={i}><CardContent className="py-6"><Skeleton className="h-6 w-64" /></CardContent></Card>)}
        </div>
      ) : view === "actions" ? (
        <div data-testid="org-action-items">
          {!actionItems || actionItems.length === 0 ? (
            <Card><CardContent className="py-10 text-center">
              <p className="text-3xl">📋</p>
              <p className="mt-2 font-medium">No action items</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Action items from shared recordings will appear here.
              </p>
            </CardContent></Card>
          ) : (
            <>
              {/* Folder tabs — "All" first, aggregating every shared folder */}
              <ScrollArea className="w-full pb-2">
                <div className="flex gap-1" role="tablist" data-testid="org-folder-tabs">
                  <Button
                    variant={activeFolderId === ALL_FOLDERS_TAB ? "secondary" : "ghost"}
                    size="sm"
                    className="shrink-0"
                    onClick={() => setActiveFolderId(ALL_FOLDERS_TAB)}
                    role="tab"
                    aria-selected={activeFolderId === ALL_FOLDERS_TAB}
                    data-testid="org-folder-tab-all"
                  >
                    <LayoutGrid className="mr-1 h-3.5 w-3.5" />
                    All
                    <Badge variant="secondary" className="ml-1.5 text-xs">
                      {actionItems.reduce((sum, f) => sum + f.items.length, 0)}
                    </Badge>
                  </Button>
                  {actionItems.map((folder) => {
                    const selected = activeFolderId === folder.folderId;
                    return (
                      <Button
                        key={folder.folderId}
                        variant={selected ? "secondary" : "ghost"}
                        size="sm"
                        className="shrink-0"
                        onClick={() => setActiveFolderId(folder.folderId)}
                        role="tab"
                        aria-selected={selected}
                        data-testid={`org-folder-tab-${folder.folderId}`}
                      >
                        <Folder className="mr-1 h-3.5 w-3.5" />
                        {folder.folderName}
                        <Badge variant="secondary" className="ml-1.5 text-xs">{folder.items.length}</Badge>
                      </Button>
                    );
                  })}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              {/* Selected folder's action items, grouped by recording/meeting, most recent first */}
              {(() => {
                const activeItems = activeFolderId === ALL_FOLDERS_TAB
                  ? actionItems.flatMap((f) => f.items)
                  : (actionItems.find((f) => f.folderId === activeFolderId)?.items ?? []);
                const activeFolderKey = activeFolderId; // for editingKey namespacing
                const recordingGroups = groupByRecording(activeItems);
                return (
                  <div className="mt-4 space-y-5">
                    {recordingGroups.length === 0 ? (
                      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
                        No action items in this folder.
                      </CardContent></Card>
                    ) : (
                      recordingGroups.map((group) => {
                        const collapsed = collapsedRecordings.has(group.recordingId);
                        return (
                        <section key={group.recordingId}>
                          {/* Meeting header: collapse toggle + date + direct chat link */}
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <button
                              className="flex min-w-0 items-center gap-2 text-sm hover:text-foreground"
                              onClick={() => toggleRecordingCollapsed(group.recordingId)}
                              data-testid={`org-recording-collapse-${group.recordingId}`}
                            >
                              {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="font-medium">{formatMeetingDate(group.recordingCreatedAt)}</span>
                              <span className="truncate text-muted-foreground">— {group.recordingFilename}</span>
                              <Badge variant="secondary" className="text-xs">{group.items.length}</Badge>
                            </button>
                            <Button variant="outline" size="sm" className="shrink-0" asChild data-testid={`org-chat-link-${group.recordingId}`}>
                              <Link href={`/org/${orgSlug}/recording/${group.recordingId}?tab=chat`}>
                                <MessageSquare className="mr-1 h-3.5 w-3.5" /> Chat
                              </Link>
                            </Button>
                          </div>

                          {!collapsed && (
                          <div className="space-y-2">
                            {group.items.map((item, i) => {
                              const key = `${activeFolderKey}:${group.recordingId}:${i}`;
                              const isEditing = editingKey === key;
                              return (
                                <div key={i}>
                                  {isEditing ? (
                                    <Card>
                                      <CardContent className="py-3 space-y-2">
                                        <Input
                                          autoFocus
                                          value={editDraft?.task ?? ""}
                                          onChange={(e) => setEditDraft((d) => d ? { ...d, task: e.target.value } : null)}
                                          placeholder="Task"
                                          data-testid="org-edit-task"
                                        />
                                        <div className="flex gap-2">
                                          <Input
                                            value={editDraft?.assignee ?? ""}
                                            onChange={(e) => setEditDraft((d) => d ? { ...d, assignee: e.target.value } : null)}
                                            placeholder="Assignee"
                                            className="flex-1"
                                          />
                                          <Input
                                            value={editDraft?.deadline ?? ""}
                                            onChange={(e) => setEditDraft((d) => d ? { ...d, deadline: e.target.value } : null)}
                                            placeholder="Deadline"
                                            className="flex-1"
                                          />
                                        </div>
                                        <div className="flex justify-end gap-1.5">
                                          <Button variant="ghost" size="sm" onClick={cancelEdit}><X className="mr-1 h-3.5 w-3.5" /> Cancel</Button>
                                          <Button size="sm" onClick={() => saveEdit(key, item)} disabled={saving || !editDraft?.task.trim()}>
                                            {saving ? "Saving…" : <><Check className="mr-1 h-3.5 w-3.5" /> Save</>}
                                          </Button>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ) : (
                                    <Card
                                      className="hover:bg-accent/40 transition-colors"
                                      onMouseEnter={() => setHoveredKey(key)}
                                      onMouseLeave={() => setHoveredKey(null)}
                                    >
                                      <CardContent className="flex items-start gap-2 py-3">
                                        <input
                                          type="checkbox"
                                          checked={item.completed}
                                          onChange={() => toggleCompleted(item)}
                                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                                          data-testid="org-item-checkbox"
                                          aria-label={item.completed ? "Mark as not done" : "Mark as done"}
                                        />
                                        <Link href={`/org/${orgSlug}/recording/${item.recordingId}`} className="min-w-0 flex-1">
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                              <p className={`font-medium text-sm ${item.completed ? "line-through text-muted-foreground" : ""}`}>{item.task}</p>
                                              <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                {item.assignee && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {item.assignee}</span>}
                                                {item.deadline && <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {item.deadline}</span>}
                                              </div>
                                            </div>
                                          </div>
                                        </Link>
                                          {isOwner && hoveredKey === key && (
                                            <span
                                              className="flex shrink-0 gap-0.5"
                                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                            >
                                              <Button
                                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                                title="Edit"
                                                onClick={() => startEdit(key, item)}
                                                data-testid="org-edit-item"
                                              >
                                                <Pencil className="h-3.5 w-3.5" />
                                              </Button>
                                              <Button
                                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                                title="Delete"
                                                onClick={() => { if (confirm("Delete this action item?")) deleteItem(item); }}
                                                data-testid="org-delete-item"
                                              >
                                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                              </Button>
                                            </span>
                                          )}
                                        </CardContent>
                                      </Card>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          )}
                        </section>
                        );
                      })
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      ) : view === "chats" ? (
        <div data-testid="org-recent-chats">
          {!recentChats || recentChats.length === 0 ? (
            <Card><CardContent className="py-10 text-center">
              <p className="text-3xl">💬</p>
              <p className="mt-2 font-medium">No chats yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Chats you've had about recordings will appear here, most recent first.
              </p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {recentChats.map((chat) => (
                <Link key={chat.recordingId} href={`/org/${orgSlug}/recording/${chat.recordingId}?tab=chat`} data-testid={`org-recent-chat-${chat.recordingId}`}>
                  <Card className="hover:bg-accent/40 transition-colors">
                    <CardContent className="flex items-start gap-3 py-4">
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{formatMeetingDate(chat.recordingCreatedAt)}</span>
                          <span className="truncate text-muted-foreground">— {chat.recordingFilename}</span>
                        </div>
                        {chat.lastMessage && (
                          <p className="mt-1 truncate text-sm text-muted-foreground">{chat.lastMessage}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div data-testid="org-recordings">
          {!folders || folders.length === 0 ? (
            <Card><CardContent className="py-10 text-center">
              <p className="text-3xl">📁</p>
              <p className="mt-2 font-medium">No shared folders</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The owner hasn't added any folders yet.
              </p>
            </CardContent></Card>
          ) : (
            <>
              {/* Folder tabs — "All" first, consistent with the Action Items view */}
              <ScrollArea className="w-full pb-2">
                <div className="flex gap-1" role="tablist" data-testid="org-recordings-folder-tabs">
                  <Button
                    variant={activeRecordingsFolderId === ALL_FOLDERS_TAB ? "secondary" : "ghost"}
                    size="sm"
                    className="shrink-0"
                    onClick={() => setActiveRecordingsFolderId(ALL_FOLDERS_TAB)}
                    role="tab"
                    aria-selected={activeRecordingsFolderId === ALL_FOLDERS_TAB}
                    data-testid="org-recordings-folder-tab-all"
                  >
                    <LayoutGrid className="mr-1 h-3.5 w-3.5" />
                    All
                    <Badge variant="secondary" className="ml-1.5 text-xs">
                      {folders.reduce((sum, f) => sum + f.recordings.length, 0)}
                    </Badge>
                  </Button>
                  {folders.map((folder) => {
                    const selected = activeRecordingsFolderId === folder.id;
                    return (
                      <Button
                        key={folder.id}
                        variant={selected ? "secondary" : "ghost"}
                        size="sm"
                        className="shrink-0"
                        onClick={() => setActiveRecordingsFolderId(folder.id)}
                        role="tab"
                        aria-selected={selected}
                        data-testid={`org-recordings-folder-tab-${folder.id}`}
                      >
                        <Folder className="mr-1 h-3.5 w-3.5" />
                        {folder.name}
                        <Badge variant="secondary" className="ml-1.5 text-xs">{folder.recordings.length}</Badge>
                      </Button>
                    );
                  })}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              {/* Selected folder's recordings, newest first */}
              {(() => {
                const activeRecordings = activeRecordingsFolderId === ALL_FOLDERS_TAB
                  ? [...folders.flatMap((f) => f.recordings)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  : (folders.find((f) => f.id === activeRecordingsFolderId)?.recordings ?? []);
                return (
                  <div className="mt-4 space-y-2">
                    {activeRecordings.length === 0 ? (
                      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
                        No recordings in this folder.
                      </CardContent></Card>
                    ) : (
                      activeRecordings.map((rec) => (
                        <Card key={rec.id} className="hover:bg-accent/40 transition-colors" data-testid={`org-recording-${rec.id}`}>
                          <CardContent className="flex items-center justify-between gap-3 py-4">
                            <Link href={`/org/${orgSlug}/recording/${rec.id}`} className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-sm">
                                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="font-medium">{formatMeetingDate(rec.createdAt)}</span>
                                <span className="truncate text-muted-foreground">— {rec.filename}</span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {rec.durationSeconds ? `${Math.floor(rec.durationSeconds / 60)}:${String(Math.round(rec.durationSeconds % 60)).padStart(2, "0")}` : "—"}</span>
                                <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {rec.speakerCount} speaker{rec.speakerCount !== 1 ? "s" : ""}</span>
                                {rec.actionItemCount > 0 && (
                                  <Badge variant="secondary" className="gap-1 text-xs">
                                    <ListTodo className="h-3 w-3" /> {rec.actionItemCount} action item{rec.actionItemCount !== 1 ? "s" : ""}
                                  </Badge>
                                )}
                              </div>
                            </Link>
                            <Button variant="outline" size="sm" className="shrink-0" asChild data-testid={`org-recordings-chat-link-${rec.id}`}>
                              <Link href={`/org/${orgSlug}/recording/${rec.id}?tab=chat`}>
                                <MessageSquare className="mr-1 h-3.5 w-3.5" /> Chat
                              </Link>
                            </Button>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
      <OrgFab orgSlug={orgSlug} isOwner={isOwner} onNavigate={setView} />
    </div>
  );
}
