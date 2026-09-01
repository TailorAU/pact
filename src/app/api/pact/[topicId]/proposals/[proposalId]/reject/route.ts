import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { sanitizeReason } from "@/lib/sanitize";
import { recordAudit, ipCountryFromHeaders } from "@/lib/audit";
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

  // Confidential rejections must include a publicSummary for anti-gridlock
  if (isConfidential && !publicSummary) {
    return NextResponse.json({ error: "Confidential rejections must include a publicSummary with actionable feedback" }, { status: 400 });
  }

  // Enforce 500 char max on publicSummary
  if (publicSummary && String(publicSummary).length > 500) {
    return NextResponse.json({ error: "publicSummary must be 500 characters or fewer" }, { status: 400 });
  }
  const cleanPublicSummary = publicSummary ? String(publicSummary).slice(0, 500) : null;

  // Sanitize reason if provided
  const cleanReason = reason ? sanitizeReason(reason) : null;
  if (reason && cleanReason && !cleanReason.valid) {
    return NextResponse.json({ error: `reason: ${cleanReason.error}` }, { status: 400 });
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

  // Block self-rejection — you can't reject your own proposal
  if (proposal.agent_id === agent.id) {
    return NextResponse.json({ error: "You cannot reject your own proposal" }, { status: 403 });
  }

  // #5599 PR-A — mutating region in ONE transaction: the status flip, the
  // reputation bump, the reject vote and the §6.4 chain link commit
  // together or not at all.
  await withTransaction(db, async (tx) => {
    await tx.execute({
      sql: "UPDATE proposals SET status = 'rejected', resolved_at = NOW() WHERE id = ?",
      args: [proposalId],
    });
    await tx.execute({
      sql: "UPDATE agents SET proposals_rejected = proposals_rejected + 1 WHERE id = ?",
      args: [proposal.agent_id as string],
    });

    await tx.execute({
      sql: "INSERT INTO votes (id, proposal_id, agent_id, vote_type, reason, confidential, public_summary) VALUES (?, ?, ?, 'reject', ?, ?, ?)",
      args: [uuid(), proposalId, agent.id, cleanReason?.sanitized ?? null, isConfidential, cleanPublicSummary],
    });

    await emitEvent(tx, topicId, "pact.proposal.rejected", agent.id, proposal.section_id as string, {
      proposalId,
      reason: isConfidential ? (cleanPublicSummary || "[Sealed rejection]") : (cleanReason?.sanitized ?? null),
      ...(isConfidential ? { confidential: true } : {}),
    });
  });

  // Audit log (#1308 / MEGA-80 WS5)
  await recordAudit({
    actorKey: agent.id,
    actorLabel: agent.name,
    op: "pact.proposal.reject",
    entityType: "proposal",
    entityId: proposalId,
    after: {
      topicId,
      proposerId: proposal.agent_id,
      sectionId: proposal.section_id,
      status: "rejected",
      confidential: !!isConfidential,
    },
    requestId: req.headers.get("x-request-id"),
    ipCountry: ipCountryFromHeaders(req.headers),
  });

  return NextResponse.json({ status: "rejected", confidential: !!isConfidential });
}
