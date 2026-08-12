"use client";

import { RecordingCard } from "@/components/recording-card";
import type { HistoryRecording } from "@/components/history-list";

export function RecordingCardGrid({
  recordings,
  onRefresh,
}: {
  recordings: HistoryRecording[];
  onRefresh?: () => void;
}) {
  if (recordings.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No recordings found. Try adjusting your search.
      </p>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      }}
      data-testid="recording-card-grid"
    >
      {recordings.map((rec) => (
        <RecordingCard key={rec.id} recording={rec} onRefresh={onRefresh} />
      ))}
    </div>
  );
}
