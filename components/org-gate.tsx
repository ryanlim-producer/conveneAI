"use client";

import { api } from "@/lib/api-path";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

interface Member {
  id: string;
  name: string;
  active: boolean;
}

export function OrgGate({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [claiming, setClaiming] = useState(false);

  async function checkPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setError(null);
    setChecking(true);
    try {
      const res = await fetch(api("/api/org/auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: orgSlug, password: password.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || "Incorrect password."); return; }
      setMembers(body.members);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setChecking(false);
    }
  }

  async function claimMember(memberId: string) {
    setClaiming(true);
    try {
      const res = await fetch(api("/api/org/auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: orgSlug, password: password.trim(), claimMemberId: memberId }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Could not join as this member.");
        // Refresh member list
        setMembers(null);
        await checkPassword({ preventDefault: () => {} } as React.FormEvent);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4" data-testid="org-gate">
      <Card className="w-full">
        <CardContent className="py-8">
          <div className="text-center mb-6">
            <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
            <h1 className="mt-2 text-xl font-semibold">Organization Access</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the organization password to continue
            </p>
          </div>

          {!members ? (
            <form onSubmit={checkPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-password">Password</Label>
                <Input
                  id="org-password"
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="Shared organization password"
                  data-testid="org-gate-password"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="org-gate-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={!password.trim() || checking} data-testid="org-gate-submit">
                {checking ? "Checking…" : "Continue"}
              </Button>
            </form>
          ) : members.length === 0 ? (
            <div className="text-center" data-testid="org-gate-no-members">
              <p className="text-sm text-muted-foreground">
                This organization hasn't added any members yet. Ask the owner to add you.
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="org-gate-members">
              <p className="text-sm font-medium">Select your name:</p>
              {members.map((m) => (
                <Button
                  key={m.id}
                  variant="outline"
                  className="w-full justify-start"
                  disabled={claiming}
                  onClick={() => claimMember(m.id)}
                  data-testid={`org-gate-member-${m.name}`}
                >
                  {m.name}
                  {m.active && <span className="ml-auto text-xs text-muted-foreground">(will replace active session)</span>}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
