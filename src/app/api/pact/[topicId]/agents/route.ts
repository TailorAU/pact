import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  const result = await db.execute({
    sql: `
    SELECT a.id, a.name as agentName, a.model, r.role, r.joined_at,
           CASE WHEN r.left_at IS NULL THEN 1 ELSE 0 END as isActive,
           r.done_status as doneStatus, r.done_at as doneAt,
           r.done_summary as doneSummary, r.confidential
    FROM registrations r
    JOIN agents a ON a.id = r.agent_id
    WHERE r.topic_id = ?
    ORDER BY r.joined_at DESC
  `,
    args: [topicId],
  });

  // Redact doneSummary for confidential registrations
  const rows = result.rows.map((row) => {
    if (row.confidential) {
      return { ...row, doneSummary: null };
    }
    return row;
  });

  return NextResponse.json(rows);
}
