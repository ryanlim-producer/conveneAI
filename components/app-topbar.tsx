"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api-path";
import { cn } from "@/lib/utils";
import { ChevronDown, Building2, User } from "lucide-react";

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

export function AppTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  // Detect current org context from pathname
  const orgMatch = pathname.match(/^\/org\/([^/]+)/);
  const currentOrgSlug = orgMatch ? orgMatch[1] : null;
  const currentOrgName = currentOrgSlug
    ? orgs.find((o) => o.slug === currentOrgSlug)?.name ?? currentOrgSlug
    : null;

  // Current context label
  const contextLabel = currentOrgName ?? "Personal";

  useEffect(() => {
    // Fetch orgs for the switcher
    fetch(api("/api/organizations"))
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (Array.isArray(d.organizations)) setOrgs(d.organizations);
      })
      .catch(() => {});
  }, []);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) {
        setOrgMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function logout() {
    await fetch(api("/api/auth/logout"), { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function switchToPersonal() {
    router.push("/");
    setOrgMenuOpen(false);
  }

  function switchToOrg(slug: string) {
    router.push(`/org/${slug}`);
    setOrgMenuOpen(false);
  }

  return (
    <header
      className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-background px-6"
      data-testid="app-topbar"
    >
      {/* Left: org switcher + app name */}
      <div className="flex items-center gap-3">
        <div className="relative" ref={orgMenuRef}>
          <button
            type="button"
            onClick={() => setOrgMenuOpen(!orgMenuOpen)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-muted/70 transition-colors"
            data-testid="org-switcher"
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span>{contextLabel}</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                orgMenuOpen && "rotate-180",
              )}
            />
          </button>

          {orgMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
              <button
                type="button"
                onClick={switchToPersonal}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  !currentOrgSlug ? "bg-muted font-medium" : "hover:bg-muted/50",
                )}
              >
                <User className="h-4 w-4 text-muted-foreground" />
                Personal
              </button>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => switchToOrg(org.slug)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
                    currentOrgSlug === org.slug
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/50",
                  )}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {org.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-sm font-medium text-muted-foreground select-none">
          conveneAI
        </span>
      </div>

      {/* Right: user avatar */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium hover:bg-muted/70 transition-colors"
          data-testid="user-avatar"
        >
          <User className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-lg"
            data-testid="user-menu"
          >
            <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border mb-1">
              Signed in
            </div>
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-muted/50"
              data-testid="logout-button"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
