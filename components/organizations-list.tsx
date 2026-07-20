"use client";

import { api } from "@/lib/api-path";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Building2, Users, Folder, Copy } from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  folderCount: number;
  createdAt: string;
}

export function OrganizationsList() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(api("/api/organizations"));
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setOrgs(data.organizations);
    } catch (e) {
      toast.error("Could not load organizations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !password.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(api("/api/organizations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password: password.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error || "Could not create organization."); return; }
      toast.success(`Organization "${body.name}" created`);
      setShowCreate(false);
      setName("");
      setPassword("");
      load();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink(slug: string) {
    const url = `${window.location.origin}${api(`/org/${slug}`)}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  if (loading) {
    return (
      <div className="space-y-3" data-testid="orgs-loading">
        {[0, 1].map((i) => (
          <Card key={i}><CardContent className="py-6"><Skeleton className="h-6 w-48" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="organizations-list">
      <div className="mb-4 flex items-center justify-between">
        <Button onClick={() => setShowCreate(true)} data-testid="new-org-button">
          <Plus className="mr-1 h-4 w-4" /> New Organization
        </Button>
      </div>

      {(!orgs || orgs.length === 0) ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-3xl"><Building2 className="mx-auto h-10 w-10 text-muted-foreground" /></p>
            <p className="mt-2 font-medium">No organizations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create an organization to share folders and recordings with your team.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <Card key={org.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <Link href={`/org/${org.slug}`} className="font-medium hover:underline" data-testid={`org-link-${org.slug}`}>
                    {org.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {org.memberCount} member{org.memberCount !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1"><Folder className="h-3 w-3" /> {org.folderCount} folder{org.folderCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyLink(org.slug)} data-testid={`org-copy-${org.slug}`}>
                  <Copy className="mr-1 h-3 w-3" /> Copy link
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Organization</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={create}>
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="e.g. Design Team" data-testid="org-name-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-password">Shared password</Label>
              <Input id="org-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder="Min. 8 characters" data-testid="org-password-input" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={!name.trim() || !password.trim() || creating} data-testid="org-create-submit">
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
