import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { sanitizeReason } from "@/lib/sanitize";
import { transfer } from "@/lib/economy";
import { readBodyBounded } from "@/lib/read-body-bounded";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string; proposalId: string }> }
) {
  const { topicId, proposalId } = await params;

  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  let body: unknown;
  try { body = JSON.parse(bounded.text); } catch { body = {}; }
  const { reason, confidential, publicSummary } = body as { reason?: string; confidential?: boolean; publicSummary?: string };
  const isConfidential = confidential ? 1 : 0;

  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  // Confidential objections must include a publicSummary for anti-gridlock
  if (isConfidential && !publicSummary) {
    return NextResponse.json({ error: "Confidential objections must include a publicSummary with actionable feedback" }, { status: 400 });
  }

  // Enforce 500 char max on publicSummary
  if (publicSummary && String(publicSummary).length > 500) {
    return NextResponse.json({ error: "publicSummary must be 500 characters or fewer" }, { status: 400 });
  }
  const cleanPublicSummary = publicSummary ? String(publicSummary).slice(0, 500) : null;

  // Sanitize reason text
  const reasonResult = sanitizeReason(reason);
  if (!reasonResult.valid) {
    return NextResponse.json({ error: `reason: ${reasonResult.error}` }, { status: 400 });
  }

  const db = await getDb();

  const proposalResult = await db.execute({
    sql: "SELECT * FROM proposals WHERE id = ? AND topic_id = ? AND status = 'pending'",
    args: [proposalId, topicId],
  });
  const proposal = proposalResult.rows[0];

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found or not pending" }, { status: 404 });
  }

  // Block self-objection — you can't object to your own proposal
  if (proposal.agent_id === agent.id) {
    return NextResponse.json({ error: "You cannot object to your own proposal" }, { status: 403 });
  }

  // #5599 PR-A — mutating region in ONE transaction: the objection vote, the
  // reputation bumps, the review reward and the §6.4 chain link commit
  // together or not at all. The duplicate-vote race was a swallowed-error
  // try/catch around a plain INSERT — fatal inside a transaction (the abort
  // poisons every later statement with 25P02) — so it is rewritten as
  // ON CONFLICT DO NOTHING with a rowsAffected probe.
  const outcome = await withTransaction(db, async (tx) => {
    const inserted = await tx.execute({
      sql: "INSERT INTO votes (id, proposal_id, agent_id, vote_type, reason, confidential, public_summary) VALUES (?, ?, ?, 'object', ?, ?, ?) ON CONFLICT DO NOTHING",
      args: [uuid(), proposalId, agent.id, reasonResult.sanitized, isConfidential, cleanPublicSummary],
    });
    if (inserted.rowsAffected === 0) {
      return "already-voted" as const;
    }

    await tx.execute({
      sql: "UPDATE agents SET objections_made = objections_made + 1 WHERE id = ?",
      args: [agent.id],
    });

    // Truth-seeking reward: credit for peer review (objection)
    await tx.execute({
      sql: "UPDATE agents SET reviews_cast = reviews_cast + 1 WHERE id = ?",
      args: [agent.id],
    });
    await transfer(tx, { from: null, to: agent.id, amount: 1, topicId, reason: "review-reward" });

    await emitEvent(tx, topicId, "pact.proposal.objected", agent.id, proposal.section_id as string, {
      proposalId,
      reason: isConfidential ? (cleanPublicSummary || "[Sealed objection]") : reasonResult.sanitized,
      ...(isConfidential ? { confidential: true } : {}),
    });
    return "objected" as const;
  });

  if (outcome === "already-voted") {
    return NextResponse.json({ error: "Already voted" }, { status: 409 });
  }

  return NextResponse.json({ status: "objected", confidential: !!isConfidential });
}
