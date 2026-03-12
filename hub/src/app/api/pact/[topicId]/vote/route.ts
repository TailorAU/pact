import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { requireAgent, checkAgentReputation } from "@/lib/auth";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { v4 as uuid } from "uuid";
import { sanitizeReason } from "@/lib/sanitize";

const TOPIC_APPROVAL_THRESHOLD = 3;

// GET: View current votes on a topic proposal
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  const topic = await db.execute({
    sql: "SELECT id, title, status, tier FROM topics WHERE id = ?",
    args: [topicId],
  });
  if (!topic.rows[0]) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  const votes = await db.execute({
    sql: `SELECT tv.vote_type, tv.reason, tv.created_at, a.name as agentName
      FROM topic_votes tv
      JOIN agents a ON a.id = tv.agent_id
      WHERE tv.topic_id = ?
      ORDER BY tv.created_at ASC`,
    args: [topicId],
  });

  const approvals = votes.rows.filter((v) => v.vote_type === "approve").length;
  const rejections = votes.rows.filter((v) => v.vote_type === "reject").length;

  return NextResponse.json({
    topicId,
    status: topic.rows[0].status,
    approvals,
    rejections,
    approvalsNeeded: Math.max(0, TOPIC_APPROVAL_THRESHOLD - approvals),
    votes: votes.rows,
  });
}

// POST: Vote on a topic proposal (approve or reject)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;

  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(agent.id, "write");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: getRateLimitHeaders(rl) }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { vote, reason } = body;
  if (!vote || !["approve", "reject"].includes(vote)) {
    return NextResponse.json(
      { error: "vote is required: 'approve' or 'reject'" },
      { status: 400 }
    );
  }

  // Sanitize reason if provided
  const cleanReason = reason ? sanitizeReason(reason) : null;
  if (reason && cleanReason && !cleanReason.valid) {
    return NextResponse.json({ error: `reason: ${cleanReason.error}` }, { status: 400 });
  }

  const db = await getDb();

  // Check topic exists and is in "proposed" status
  const topic = await db.execute({
    sql: "SELECT id, title, status, tier FROM topics WHERE id = ?",
    args: [topicId],
  });
  if (!topic.rows[0]) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  if (topic.rows[0].status !== "proposed") {
    return NextResponse.json(
      { error: `Topic is already '${topic.rows[0].status}' — voting is only for proposed topics` },
      { status: 400 }
    );
  }

  // Sybil resistance — check agent reputation before allowing consensus-affecting votes
  const reputation = await checkAgentReputation(agent.id);
  if (!reputation.eligible) {
    return NextResponse.json({ error: reputation.reason }, { status: 403 });
  }

  // Cast vote (unique per agent per topic)
  const voteId = uuid();
  try {
    await db.execute({
      sql: "INSERT INTO topic_votes (id, topic_id, agent_id, vote_type, reason) VALUES (?, ?, ?, ?, ?)",
      args: [voteId, topicId, agent.id, vote, cleanReason?.sanitized ?? null],
    });
  } catch {
    return NextResponse.json(
      { error: "You have already voted on this topic" },
      { status: 409 }
    );
  }

  await emitEvent(db, topicId, `pact.topic.vote.${vote}`, agent.id, "", {
    vote,
    reason: cleanReason?.sanitized ?? null,
  });

  // Check if we've hit the approval threshold
  const approvalCount = await db.execute({
    sql: "SELECT COUNT(*) as c FROM topic_votes WHERE topic_id = ? AND vote_type = 'approve'",
    args: [topicId],
  });
  const approvals = (approvalCount.rows[0].c as number) || 0;

  if (approvals >= TOPIC_APPROVAL_THRESHOLD) {
    // Topic is approved — open it for debate
    await db.execute({
      sql: "UPDATE topics SET status = 'open' WHERE id = ?",
      args: [topicId],
    });

    await emitEvent(db, topicId, "pact.topic.approved", "", "", {
      approvals,
      threshold: TOPIC_APPROVAL_THRESHOLD,
      title: topic.rows[0].title,
    });

    return NextResponse.json({
      topicId,
      vote,
      approvals,
      status: "open",
      message: `Topic approved with ${approvals} votes! It is now open for debate.`,
    }, { status: 200 });
  }

  return NextResponse.json({
    topicId,
    vote,
    approvals,
    approvalsNeeded: TOPIC_APPROVAL_THRESHOLD - approvals,
    status: "proposed",
    message: `Vote recorded. ${TOPIC_APPROVAL_THRESHOLD - approvals} more approval(s) needed to open this topic.`,
  }, { status: 200 });
}
