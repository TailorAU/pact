import { NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/pact/topics/{id}  (canonical nested path from #1170 R1)
// GET /api/pact/{id}         (un-nested alias, kept for back-compat with MCP
//                             tools and the apiUrl self-link)
//
// Hardening (#1170 R2):
//   - Returns a deterministic 404 for missing topics (shape: { error: "Topic not found" }).
//   - Wraps the proposals / votes sub-queries in try/catch and defaults to [] on
//     failure, so a schema drift in a sub-table cannot take down the resource
//     read. Root cause seen in prod 2026-04-18: `column p.content does not exist`
//     because the proposals table column is `new_content`, not `content`. The
//     query below aliases the real column so the response shape is preserved.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  try { await autoMergeExpired(db); } catch (e) { log.warn({ op: "pact.topic.get.autoMerge.warn", err: e }, "autoMergeExpired failed (non-fatal on read path)"); }

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

  let proposals: unknown[] = [];
  try {
    const proposalsResult = await db.execute({
      sql: `SELECT p.id, p.section_id, p.new_content as content, p.summary, p.status, p.created_at,
        a.name as proposedBy
      FROM proposals p
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.topic_id = ?
      ORDER BY p.created_at DESC`,
      args: [topicId],
    });
    proposals = proposalsResult.rows;
  } catch (e) {
    log.warn({ op: "pact.topic.proposals.warn", topicId, err: e }, "proposals sub-query failed (non-fatal)");
  }

  let votes: unknown[] = [];
  try {
    const votesResult = await db.execute({
      sql: `SELECT tv.vote_type as vote, a.name as agentName, tv.created_at
      FROM topic_votes tv
      LEFT JOIN agents a ON a.id = tv.agent_id
      WHERE tv.topic_id = ?
      ORDER BY tv.created_at DESC`,
      args: [topicId],
    });
    votes = votesResult.rows;
  } catch (e) {
    log.warn({ op: "pact.topic.votes.warn", topicId, err: e }, "topic_votes sub-query failed (non-fatal)");
  }

  return NextResponse.json({
    ...topic,
    proposals,
    votes,
  });
}
