import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { notFound } from "next/navigation";
import { FolderDetailContent } from "@/components/folder-detail-content";

export const metadata = { title: "Folder — conveneAI" };

export default async function FolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const user = await requireUser();

  const row = db
    .prepare(
      `SELECT g.id, g.name, g.created_at,
              COALESCE(
                (SELECT COUNT(*) FROM recordings r WHERE r.group_id = g.id AND r.user_id = g.user_id),
                0
              ) AS recording_count,
              COALESCE(
                (SELECT MAX(r.created_at) FROM recordings r
                 WHERE r.group_id = g.id AND r.user_id = g.user_id),
                g.created_at
              ) AS last_activity
       FROM groups g
       WHERE g.id = ? AND g.user_id = ?`,
    )
    .get(id, user.userId) as
    | {
        id: string;
        name: string;
        created_at: string;
        recording_count: number;
        last_activity: string;
      }
    | undefined;

  if (!row) {
    notFound();
  }

  return (
    <div className="p-8">
      <FolderDetailContent
        folder={{
          id: row.id,
          name: row.name,
          recordingCount: row.recording_count,
          lastActivity: row.last_activity,
          createdAt: row.created_at,
        }}
      />
    </div>
  );
}
