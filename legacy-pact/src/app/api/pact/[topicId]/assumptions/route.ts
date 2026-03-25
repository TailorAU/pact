import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET: List all assumption declarations for a topic.
// Shows which agents declared which assumptions, whether they were newly created,
// and the current status of each assumption topic.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;

  const db = await getDb();

  // Check topic exists
  const topicCheck = await db.execute({ sql: "SELECT id, title FROM topics WHERE id = ?", args: [topicId] });
  if (topicCheck.rows.length === 0) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  // Get all assumption declarations with joined topic + agent data
  const declarations = await db.execute({
    sql: `SELECT
      ad.assumption_topic_id,
      ad.created_new,
      ad.created_at as declared_at,
      t.title as assumption_title,
      t.tier as assumption_tier,
      t.status as assumption_status,
      a.name as declared_by,
      a.id as declared_by_id
    FROM assumption_declarations ad
    JOIN topics t ON t.id = ad.assumption_topic_id
    JOIN agents a ON a.id = ad.agent_id
    WHERE ad.topic_id = ?
    ORDER BY ad.created_at ASC`,
    args: [topicId],
  });

  // Also get dependency-linked assumptions that may predate the QA gate
  // (i.e. assumptions added via the dependencies endpoint directly)
  const depAssumptions = await db.execute({
    sql: `SELECT
      td.depends_on as assumption_topic_id,
      t.title as assumption_title,
      t.tier as assumption_tier,
      t.status as assumption_status
    FROM topic_dependencies td
    JOIN topics t ON t.id = td.depends_on
    WHERE td.topic_id = ? AND td.relationship = 'assumes'
    ORDER BY td.created_at ASC`,
    args: [topicId],
  });

  // Get bounty info for assumption topics
  const assumptionTopicIds = new Set<string>();
  for (const row of declarations.rows) {
    assumptionTopicIds.add(row.assumption_topic_id as string);
  }
  for (const row of depAssumptions.rows) {
    assumptionTopicIds.add(row.assumption_topic_id as string);
  }

  const bountyMap = new Map<string, number>();
  for (const tid of assumptionTopicIds) {
    const bountyResult = await db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) as total FROM topic_bounties WHERE topic_id = ? AND status = 'escrow'",
      args: [tid],
    });
    bountyMap.set(tid, (bountyResult.rows[0]?.total as number) || 0);
  }

  // Count unique agents who declared assumptions
  const uniqueAgents = new Set<string>();
  for (const row of declarations.rows) {
    uniqueAgents.add(row.declared_by_id as string);
  }

  // Build deduplicated assumption list
  const seen = new Set<string>();
  const assumptionList: Record<string, unknown>[] = [];

  // Declarations first (they have richer data)
  for (const row of declarations.rows) {
    const tid = row.assumption_topic_id as string;
    if (seen.has(tid)) continue;
    seen.add(tid);
    assumptionList.push({
      topicId: tid,
      title: row.assumption_title,
      tier: row.assumption_tier,
      status: row.assumption_status,
      declaredBy: row.declared_by,
      createdNew: (row.created_new as number) === 1,
      bountyEscrow: bountyMap.get(tid) || 0,
      declaredAt: row.declared_at,
    });
  }

  // Then dependency-linked ones not already in declarations
  for (const row of depAssumptions.rows) {
    const tid = row.assumption_topic_id as string;
    if (seen.has(tid)) continue;
    seen.add(tid);
    assumptionList.push({
      topicId: tid,
      title: row.assumption_title,
      tier: row.assumption_tier,
      status: row.assumption_status,
      declaredBy: null,
      createdNew: false,
      bountyEscrow: bountyMap.get(tid) || 0,
      declaredAt: null,
    });
  }

  return NextResponse.json({
    topicId,
    topicTitle: topicCheck.rows[0].title,
    assumptions: assumptionList,
    totalAssumptions: assumptionList.length,
    totalDeclaredBy: uniqueAgents.size,
  });
}
