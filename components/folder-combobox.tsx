"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Folder, LayoutGrid, ChevronsUpDown, Search } from "lucide-react";

export interface FolderOption {
  id: string;
  name: string;
  count: number;
}

export const ALL_FOLDERS_VALUE = "__all__";

export function FolderCombobox({
  folders,
  value,
  onChange,
  totalCount,
}: {
  folders: FolderOption[];
  value: string;
  onChange: (id: string) => void;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const filtered = query.trim()
    ? folders.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
    : folders;

  const selectedLabel = value === ALL_FOLDERS_VALUE
    ? "All folders"
    : folders.find((f) => f.id === value)?.name ?? "All folders";

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className="relative w-full max-w-xs" data-testid="org-folder-combobox">
      <Button
        variant="outline"
        className="w-full justify-between"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="org-folder-combobox-trigger"
      >
        <span className="flex items-center gap-2 truncate">
          {value === ALL_FOLDERS_VALUE ? <LayoutGrid className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{selectedLabel}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div
          className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1.5 shadow-md"
          data-testid="org-folder-combobox-panel"
        >
          <div className="relative mb-1.5">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search folders…"
              className="h-8 pl-7"
              data-testid="org-folder-combobox-search"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => select(ALL_FOLDERS_VALUE)}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${value === ALL_FOLDERS_VALUE ? "bg-accent" : ""}`}
              data-testid="org-folder-combobox-option-all"
            >
              <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">All folders</span>
              <Badge variant="secondary" className="text-xs">{totalCount}</Badge>
            </button>
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">No matching folders.</p>
            ) : (
              filtered.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => select(f.id)}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${value === f.id ? "bg-accent" : ""}`}
                  data-testid={`org-folder-combobox-option-${f.id}`}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <Badge variant="secondary" className="text-xs">{f.count}</Badge>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
