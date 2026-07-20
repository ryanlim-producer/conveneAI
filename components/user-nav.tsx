"use client";

import { api } from "@/lib/api-path";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, ListChecks, Settings, LogOut, Home, Building2 } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "Recordings", icon: Home },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/queue", label: "Queue", icon: ListChecks },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function UserNav({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await fetch(api("/api/auth/logout"), { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex flex-wrap items-center gap-1" data-testid="user-nav">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => (
        <Button
          key={href}
          variant={pathname === href ? "secondary" : "ghost"}
          size="sm"
          asChild
        >
          <Link href={href}>
            <Icon className="mr-1 h-4 w-4" />
            {label}
          </Link>
        </Button>
      ))}
      <span className="mx-2 hidden text-xs text-muted-foreground sm:inline" title={email}>
        {email}
      </span>
      <Button variant="ghost" size="sm" onClick={logout} title="Sign out" data-testid="logout-button">
        <LogOut className="h-4 w-4" />
      </Button>
    </nav>
  );
}
