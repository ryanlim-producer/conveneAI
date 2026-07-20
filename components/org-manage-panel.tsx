"use client";

import { api } from "@/lib/api-path";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Folder, Users, Key, Plus, Trash2, User,
  FolderOpen, Circle, Link2Off,
} from "lucide-react";

interface SharedFolder { id: string; name: string; recordingCount: number; }

interface Member {
  id: string;
  name: string;
  active: boolean;
}

interface AvailableGroup {
  id: string;
  name: string;
  recordingCount: number;
}

export function OrgManagePanel({
  orgId, orgName, orgSlug,
}: {
  orgId: string;
  orgName: string;
  orgSlug: string;
}) {
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[] | null>(null);
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Add member state
  const [newMemberName, setNewMemberName] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [sharedRes, groupsRes, membersRes] = await Promise.all([
        fetch(api(`/api/org/${orgId}/folders`)),
        fetch(api("/api/groups")),
        fetch(api(`/api/org/${orgId}/members`)),
      ]);

      if (sharedRes.ok) {
        const data = await sharedRes.json();
        const folders = data.folders.map((f: { id: string; name: string; recordings: unknown[] }) => ({
          id: f.id,
          name: f.name,
          recordingCount: f.recordings.length,
        }));
        setSharedFolders(folders);
      }

      if (groupsRes.ok) {
        const data = await groupsRes.json();
        setAvailableGroups(data.groups);
      }

      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members);
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [orgId]);

  async function addFolder(groupId: string) {
    const res = await fetch(api(`/api/org/${orgId}/folders`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    if (res.ok) {
      toast.success("Folder added to organization.");
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || "Could not add folder.");
    }
  }

  async function removeFolder(groupId: string) {
    const res = await fetch(api(`/api/org/${orgId}/folders?groupId=${encodeURIComponent(groupId)}`), {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Folder unlinked from organization.");
      load();
    } else {
      toast.error("Could not remove folder.");
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!newMemberName.trim()) return;
    setAddingMember(true);
    try {
      const res = await fetch(api(`/api/org/${orgId}/members`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newMemberName.trim() }),
      });
      if (res.ok) {
        toast.success(`Member "${newMemberName.trim()}" added.`);
        setNewMemberName("");
        load();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not add member.");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setAddingMember(false);
    }
  }

  async function removeMember(memberId: string, memberName: string) {
    const res = await fetch(api(`/api/org/${orgId}/members?memberId=${encodeURIComponent(memberId)}`), {
      method: "DELETE",
    });
    if (res.ok) {
      const body = await res.json();
      toast.success(`Member "${memberName}" removed (${body.deletedChatCount} chat messages deleted).`);
      load();
    } else {
      toast.error("Could not remove member.");
    }
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword.trim() || newPassword.trim().length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch(api(`/api/org/${orgId}/settings`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword.trim() }),
      });
      if (res.ok) {
        toast.success("Password updated.");
        setNewPassword("");
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not update password.");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8" data-testid="org-manage-loading">
        <Skeleton className="h-8 w-48 mb-6" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full mb-4" />)}
      </div>
    );
  }

  const sharedGroupIds = new Set(sharedFolders?.map((f) => f.id) ?? []);
  const unsharedGroups = (availableGroups ?? []).filter((g) => !sharedGroupIds.has(g.id));

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8" data-testid="org-manage-panel">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/org/${orgSlug}`}>
            <ArrowLeft className="h-4 w-4" /> Back to workspace
          </Link>
        </Button>
      </div>
      <h1 className="text-2xl font-semibold mb-6">Manage: {orgName}</h1>

      {/* Folders Section */}
      <Card className="mb-6" data-testid="manage-folders-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4" /> Shared Folders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sharedFolders && sharedFolders.length > 0 ? (
            <ul className="space-y-2">
              {sharedFolders.map((folder) => (
                <li key={folder.id} className="flex items-center justify-between rounded-md border px-3 py-2" data-testid={`shared-folder-${folder.id}`}>
                  <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{folder.name}</span>
                    <Badge variant="secondary" className="text-xs">{folder.recordingCount} recording{folder.recordingCount !== 1 ? "s" : ""}</Badge>
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => removeFolder(folder.id)}
                    data-testid={`remove-folder-${folder.id}`}
                    title="Unlink from organization"
                  >
                    <Link2Off className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No folders shared with this organization yet.</p>
          )}

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">Add folders</p>
            {unsharedGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {availableGroups && availableGroups.length > 0
                  ? "All your folders are already shared."
                  : "You don't have any folders yet. Create one in your main app first."}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="available-folders">
                {unsharedGroups.map((group) => (
                  <li key={group.id} className="flex items-center justify-between rounded-md px-3 py-1.5 hover:bg-accent">
                    <div className="flex items-center gap-2">
                      <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{group.name}</span>
                      <Badge variant="outline" className="text-xs">{group.recordingCount} recording{group.recordingCount !== 1 ? "s" : ""}</Badge>
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => addFolder(group.id)}
                      data-testid={`add-folder-${group.id}`}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Members Section */}
      <Card className="mb-6" data-testid="manage-members-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Members
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members && members.length > 0 ? (
            <ul className="space-y-2">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between rounded-md border px-3 py-2" data-testid={`member-${member.id}`}>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {member.active && (
                        <Circle className="absolute -top-0.5 -right-0.5 h-2 w-2 fill-green-500 text-green-500" data-testid={`member-active-${member.id}`} />
                      )}
                    </div>
                    <span className="text-sm">{member.name}</span>
                    {member.active && <Badge variant="secondary" className="text-xs">Online</Badge>}
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => removeMember(member.id, member.name)}
                    data-testid={`remove-member-${member.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No members added yet.</p>
          )}

          <Separator />

          <form onSubmit={addMember} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="new-member-name" className="text-sm font-medium">Add member</label>
              <Input
                id="new-member-name"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="e.g. Alice"
                data-testid="new-member-input"
              />
            </div>
            <Button type="submit" disabled={!newMemberName.trim() || addingMember} data-testid="add-member-submit">
              {addingMember ? "Adding…" : <><Plus className="mr-1 h-4 w-4" /> Add</>}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Settings Section */}
      <Card data-testid="manage-settings-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" /> Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={updatePassword} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="new-password" className="text-sm font-medium">Change shared password</label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min. 8 characters)"
                data-testid="new-password-input"
              />
            </div>
            <Button
              type="submit"
              disabled={!newPassword.trim() || newPassword.trim().length < 8 || savingPassword}
              data-testid="save-password-submit"
            >
              <Key className="mr-1 h-4 w-4" />
              {savingPassword ? "Saving…" : "Update"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
