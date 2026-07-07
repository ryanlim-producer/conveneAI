import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDb } from "@/lib/db";
import type { ActionItem } from "@/lib/action-extractor";

/** Replaces a recording's action items (the UI edits the full list). */
export const PUT = withAuth<{ id: string }>(async (req: NextRequest, { user, params }) => {
  const id = params?.id;
  const owned = id
    ? getDb().prepare("SELECT id FROM recordings WHERE id = ? AND user_id = ?").get(id, user.userId)
    : undefined;
  if (!owned) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  let body: { actionItems?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.actionItems)) {
    return NextResponse.json({ error: "actionItems must be an array." }, { status: 400 });
  }

  const items: ActionItem[] = [];
  for (const raw of body.actionItems) {
    if (typeof raw !== "object" || raw === null || typeof (raw as ActionItem).task !== "string" ||
        !(raw as ActionItem).task.trim()) {
      return NextResponse.json(
        { error: "Every action item needs a non-empty task." },
        { status: 400 },
      );
    }
    const item = raw as Partial<ActionItem>;
    items.push({
      task: item.task!.trim(),
      assignee: (item.assignee ?? "").toString().trim(),
      deadline: (item.deadline ?? "").toString().trim(),
      context: (item.context ?? "").toString().trim(),
    });
  }

  getDb()
    .prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
    .run(JSON.stringify(items), id);

  return NextResponse.json({ actionItems: items });
});
