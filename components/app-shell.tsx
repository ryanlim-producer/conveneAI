"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";

const AUTH_PATHS = ["/login", "/register"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Auth pages get no shell — just the raw form
  if (AUTH_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden" data-testid="app-shell">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
