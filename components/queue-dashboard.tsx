"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock,
  Loader2,
  ListTodo,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Monitor,
  Send,
  Globe,
} from "lucide-react";

interface Job {
  id: string;
  status: "queued" | "transcribing" | "processing_action_items" | "done" | "error";
  source: "desktop" | "telegram" | "web_upload";
  filename: string;
  errorMessage: string | null;
  modelUsed: string | null;
  createdAt: string;
  recordingId: string | null;
}

const STATUS_META: Record<Job["status"], { label: string; variant: "secondary" | "default" | "destructive"; Icon: typeof Clock; spin?: boolean }> = {
  queued: { label: "Queued", variant: "secondary", Icon: Clock },
  transcribing: { label: "Transcribing", variant: "default", Icon: Loader2, spin: true },
  processing_action_items: { label: "Extracting actions", variant: "default", Icon: ListTodo },
  done: { label: "Done", variant: "secondary", Icon: CheckCircle2 },
  error: { label: "Failed", variant: "destructive", Icon: XCircle },
};

const SOURCE_ICONS = { desktop: Monitor, telegram: Send, web_upload: Globe };

function formatDate(sqliteUtc: string): string {
  const date = new Date(sqliteUtc.replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return sqliteUtc;
  return date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QueueDashboard() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [live, setLive] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/queue");
      if (res.ok) setJobs((await res.json()).jobs);
    } catch {
      // Poll again next tick
    }
  }, []);

  useEffect(() => {
    // SSE first; fall back to 5s polling if the stream can't connect
    const source = new EventSource("/api/queue?stream=true");

    source.onopen = () => setLive(true);
    source.onmessage = (event) => {
      try {
        setJobs(JSON.parse(event.data).jobs);
      } catch {
        // Ignore malformed frames
      }
    };
    source.onerror = () => {
      setLive(false);
      source.close();
      loadOnce();
      if (!pollTimer.current) {
        pollTimer.current = setInterval(loadOnce, 5000);
      }
    };

    return () => {
      source.close();
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [loadOnce]);

  async function retry(jobId: string) {
    const res = await fetch(`/api/queue/${jobId}/retranscribe`, { method: "POST" });
    if (res.status === 202) {
      toast.success("Re-queued for processing");
      loadOnce();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || "Could not retry this job.");
    }
  }

  if (jobs === null) {
    return (
      <div className="space-y-3" data-testid="queue-loading">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 py-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center" data-testid="queue-empty">
          <p className="text-3xl">📭</p>
          <p className="mt-2 font-medium">No jobs yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload an audio file and it will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="queue-list">
      <p className="text-right text-xs text-muted-foreground">
        {live ? "● Live updates" : "○ Polling every 5s"}
      </p>
      {jobs.map((job) => {
        const meta = STATUS_META[job.status];
        const SourceIcon = SOURCE_ICONS[job.source];
        return (
          <Card key={job.id} data-testid={`job-${job.id}`}>
            <CardContent className="flex items-center gap-4 py-4">
              <SourceIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{job.filename}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(job.createdAt)}</span>
                  {job.modelUsed && <span>· {job.modelUsed}</span>}
                </div>
                {job.status === "error" && job.errorMessage && (
                  <p className="mt-1 text-xs text-destructive" data-testid="job-error">
                    {job.errorMessage}
                  </p>
                )}
              </div>
              <Badge variant={meta.variant} className="shrink-0 gap-1" data-testid="job-status">
                <meta.Icon className={`h-3 w-3 ${meta.spin ? "animate-spin" : ""}`} />
                {meta.label}
              </Badge>
              {(job.status === "error" || job.status === "done") && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Re-transcribe"
                  onClick={() => retry(job.id)}
                  data-testid="job-retry"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
