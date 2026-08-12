"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api-path";
import type { HistoryRecording } from "@/components/history-list";

interface FolderInfo {
  id: string;
  name: string;
}

interface UseRecordingsReturn {
  recordings: HistoryRecording[] | null;
  folders: FolderInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRecordings(options?: { groupId?: string }): UseRecordingsReturn {
  const { groupId } = options ?? {};
  const [recordings, setRecordings] = useState<HistoryRecording[] | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const historyUrl = groupId
        ? api(`/api/history?groupId=${encodeURIComponent(groupId)}`)
        : api("/api/history");
      const res = await fetch(historyUrl);
      // Folders are always fetched (best-effort, harmless on folder detail page)
      void Promise.resolve(fetch(api("/api/groups")))
        .then(async (r) => {
          if (!r?.ok) return;
          const d = await r.json().catch(() => null);
          if (Array.isArray(d?.groups)) setFolders(d.groups);
        })
        .catch(() => {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setRecordings(data.recordings);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — check that the server is running and try refreshing.`
          : "Failed to load history — try refreshing.",
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { recordings, folders, loading, error, refresh };
}
