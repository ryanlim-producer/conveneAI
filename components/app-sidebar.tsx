"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Plus,
  MessageSquare,
  Home,
  ListTodo,
  ListChecks,
  Settings,
  Key,
  Building2,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
}

interface NavSection {
  label: string;
  testId: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Create",
    testId: "sidebar-section-create",
    items: [
      { label: "New Recording", href: "/upload", icon: Plus, testId: "sidebar-item-new-recording" },
      { label: "New Chat", href: "/", icon: MessageSquare, testId: "sidebar-item-new-chat" },
    ],
  },
  {
    label: "Workspace",
    testId: "sidebar-section-workspace",
    items: [
      { label: "All Recordings", href: "/", icon: Home, testId: "sidebar-item-all-recordings" },
      { label: "Action Items", href: "/", icon: ListTodo, testId: "sidebar-item-action-items" },
      { label: "Queue", href: "/queue", icon: ListChecks, testId: "sidebar-item-queue" },
    ],
  },
  {
    label: "Settings",
    testId: "sidebar-section-settings",
    items: [
      { label: "Account", href: "/settings", icon: Settings, testId: "sidebar-item-settings" },
      { label: "API Keys", href: "/settings", icon: Key, testId: "sidebar-item-api-keys" },
      { label: "Organizations", href: "/organizations", icon: Building2, testId: "sidebar-item-organizations" },
    ],
  },
];

function SidebarNavItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      data-testid={item.testId}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside
      className="flex w-[280px] shrink-0 flex-col border-r border-border bg-card"
      data-testid="app-sidebar"
    >
      {/* Brand area */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-lg font-semibold">🎙 conveneAI</span>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {SECTIONS.map((section) => (
          <div key={section.testId} className="mb-6">
            <h3
              data-testid={section.testId}
              className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              {section.label}
            </h3>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SidebarNavItem
                  key={item.testId}
                  item={item}
                  active={isActive(item.href)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
