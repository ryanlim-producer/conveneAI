"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreationModuleProps {
  /** Total number of recordings */
  count: number;
  /** When set, the Upload button links to /upload?folderId=... */
  folderId?: string;
}

function uploadHref(folderId?: string): string {
  if (folderId) return `/upload?folderId=${encodeURIComponent(folderId)}`;
  return "/upload";
}

/**
 * Progressive creation module:
 * - 0 recordings: full centered hero (the empty state itself)
 * - 1-3: centered but smaller creation prompt above the list
 * - 4+: compact inline action bar
 */
export function CreationModule({ count, folderId }: CreationModuleProps) {
  // 4+ recordings: compact action bar
  if (count >= 4) {
    return (
      <div className="mb-6 flex items-center gap-3" data-testid="creation-bar">
        <Button asChild className="rounded-full" size="sm">
          <Link href={uploadHref(folderId)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Upload recording
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">
          {count} recording{count !== 1 ? "s" : ""}
        </span>
      </div>
    );
  }

  // 1-3 recordings: centered creation module with less prominence
  if (count >= 1) {
    return (
      <div className="mb-10 text-center" data-testid="creation-module">
        <h2 className="mb-3 text-xl font-bold">Create a recording</h2>
        <Button asChild className="rounded-full" size="lg">
          <Link href={uploadHref(folderId)}>
            <Plus className="mr-2 h-5 w-5" />
            Upload recording
          </Link>
        </Button>
      </div>
    );
  }

  // 0 recordings: full hero — this IS the empty state
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center text-center"
      data-testid="creation-hero"
    >
      <h1 className="mb-4 text-3xl font-bold tracking-tight">
        Create a recording
      </h1>
      <p className="mb-8 max-w-md text-muted-foreground">
        Upload an audio recording to get automatic transcription, action items,
        and an AI-powered chat experience.
      </p>
      <Button asChild size="lg" className="rounded-full px-8">
        <Link href={uploadHref(folderId)}>
          <Plus className="mr-2 h-5 w-5" />
          Upload recording
        </Link>
      </Button>
      <p className="mt-4 text-sm text-muted-foreground">
        Supports MP3, WAV, M4A, and video files
      </p>
    </div>
  );
}
