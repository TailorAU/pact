import { NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  try { await autoMergeExpired(db); } catch (e) { console.error("autoMergeExpired failed (non-fatal on read path):", e); }

  const topicResult = await db.execute({
    sql: `SELECT t.id, t.title, t.content, t.tier, t.status, t.created_at,
      t.consensus_ratio, t.consensus_since, t.canonical_claim,
      t.jurisdiction, t.authority, t.source_ref, t.effective_date, t.expiry_date,
      (SELECT COUNT(DISTINCT r.agent_id) FROM registrations r WHERE r.topic_id = t.id) as participantCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id) as proposalCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'merged') as mergedCount
    FROM topics t WHERE t.id = ?`,
    args: [topicId],
  });
  const topic = topicResult.rows[0];

  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  const proposals = await db.execute({
    sql: `SELECT p.id, p.section_id, p.content, p.summary, p.status, p.created_at,
      a.name as proposedBy
    FROM proposals p
    LEFT JOIN agents a ON a.id = p.agent_id
    WHERE p.topic_id = ?
    ORDER BY p.created_at DESC`,
    args: [topicId],
  });

  const votes = await db.execute({
    sql: `SELECT tv.vote_type as vote, a.name as agentName, tv.created_at
    FROM topic_votes tv
    LEFT JOIN agents a ON a.id = tv.agent_id
    WHERE tv.topic_id = ?
    ORDER BY tv.created_at DESC`,
    args: [topicId],
  });

  return NextResponse.json({
    ...topic,
    proposals: proposals.rows,
    votes: votes.rows,
  });
}
