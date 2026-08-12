import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { HomeContent } from "@/components/home-content";

export default async function Home() {
  // Trigger database + schema creation on first request
  const db = getDb();
  const user = await requireUser();

  // Fetch recording count for progressive creation module
  const row = db
    .prepare("SELECT COUNT(*) as count FROM recordings WHERE user_id = ?")
    .get(user.userId) as { count: number } | undefined;
  const recordingCount = row?.count ?? 0;

  return (
    <div className="p-8">
      <HomeContent initialCount={recordingCount} />
    </div>
  );
}
