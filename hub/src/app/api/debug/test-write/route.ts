import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/debug/test-write — Test if writes persist in Turso
export async function GET() {
  const db = await getDb();
  const ts = new Date().toISOString();

  // Read a topic's current status
  const before = await db.execute(
    "SELECT id, status FROM topics ORDER BY created_at ASC LIMIT 1"
  );

  if (before.rows.length === 0) {
    return NextResponse.json({ error: "No topics found" });
  }

  const topicId = before.rows[0].id as string;
  const statusBefore = before.rows[0].status as string;

  // If it's 'open', change to 'consensus'. If 'consensus', change back to 'open'.
  const newStatus = statusBefore === "open" ? "consensus" : "open";

  await db.execute({
    sql: "UPDATE topics SET status = ? WHERE id = ?",
    args: [newStatus, topicId],
  });

  // Read it back immediately
  const after = await db.execute({
    sql: "SELECT status FROM topics WHERE id = ?",
    args: [topicId],
  });

  return NextResponse.json({
    topicId,
    statusBefore,
    targetStatus: newStatus,
    statusAfter: after.rows[0]?.status,
    timestamp: ts,
    note: "Call this endpoint again to see if the change persisted across invocations",
  });
}
