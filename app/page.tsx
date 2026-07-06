import { getDb } from "@/lib/db";
import { AppHeader } from "@/components/app-header";
import { HistoryList } from "@/components/history-list";

export default async function Home() {
  // Trigger database + schema creation on first request
  getDb();
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="Meeting Transcription + Action Items Platform" />
      <HistoryList />
    </div>
  );
}
