import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, runConsensusStatusUpdate, withTransaction } from "@/lib/db";
import { requireAgent, checkAgentReputation } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { transfer } from "@/lib/economy";
import { recordAudit, ipCountryFromHeaders } from "@/lib/audit";

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

  const db = await getDb();

  const proposalResult = await db.execute({
    sql: "SELECT * FROM proposals WHERE id = ? AND topic_id = ? AND status = 'pending'",
    args: [proposalId, topicId],
  });
  const proposal = proposalResult.rows[0];

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found or not pending" }, { status: 404 });
  }

  // Block self-approval — you can't approve your own proposal
  if (proposal.agent_id === agent.id) {
    return NextResponse.json({ error: "You cannot approve your own proposal" }, { status: 403 });
  }

  // Sybil resistance — check agent reputation before allowing consensus-affecting votes
  const reputation = await checkAgentReputation(agent.id);
  if (!reputation.eligible) {
    return NextResponse.json({ error: reputation.reason }, { status: 403 });
  }

  // #5599 PR-A — mutating region in ONE transaction: the approve vote, the
  // review reward, the merge writes and both §6.4 chain links commit
  // together or not at all. The duplicate-vote race was a swallowed-error
  // try/catch around a plain INSERT — fatal inside a transaction (25P02 on
  // every later statement) — so it is rewritten as ON CONFLICT DO NOTHING
  // with a rowsAffected probe.
  type ApproveOutcome =
    | { kind: "already-voted" }
    | { kind: "merged"; approveCount: number; objectCount: number; needsMajority: boolean }
    | {
        kind: "approved";
        approveCount: number;
        objectCount: number;
        requiredApprovals: number;
        needsMajority: boolean;
      };

  const outcome = await withTransaction(db, async (tx): Promise<ApproveOutcome> => {
    // Record vote
    const inserted = await tx.execute({
      sql: "INSERT INTO votes (id, proposal_id, agent_id, vote_type) VALUES (?, ?, ?, 'approve') ON CONFLICT DO NOTHING",
      args: [uuid(), proposalId, agent.id],
    });
    if (inserted.rowsAffected === 0) {
      return { kind: "already-voted" };
    }

    // Truth-seeking reward: credit for peer review
    await tx.execute({
      sql: "UPDATE agents SET reviews_cast = reviews_cast + 1 WHERE id = ?",
      args: [agent.id],
    });
    await transfer(tx, { from: null, to: agent.id, amount: 1, topicId, reason: "review-reward" });

    // Count current votes on this proposal
    const voteCountResult = await tx.execute({
      sql: `SELECT
      (SELECT COUNT(*) FROM votes WHERE proposal_id = ? AND vote_type = 'approve') as approveCount,
      (SELECT COUNT(*) FROM votes WHERE proposal_id = ? AND vote_type = 'object') as objectCount`,
      args: [proposalId, proposalId],
    });
    const approveCount = (voteCountResult.rows[0].approveCount as number) || 0;
    const objectCount = (voteCountResult.rows[0].objectCount as number) || 0;

    // Count registered agents for this topic (for majority calculation)
    const regCountResult = await tx.execute({
      sql: "SELECT COUNT(*) as c FROM registrations WHERE topic_id = ? AND left_at IS NULL",
      args: [topicId],
    });
    const registeredAgents = (regCountResult.rows[0].c as number) || 1;

    // Merge policy:
    // - No objections: min(2, registeredAgents) approvals needed (prevents single-agent rubber-stamping)
    // - With objections: need ceil(registeredAgents * 0.5) approvals (majority rule)
    // - Solo topics (1 participant): 1 approval still required (from a non-author)
    const needsMajority = objectCount > 0;
    const requiredApprovals = needsMajority
      ? Math.ceil(registeredAgents * 0.5)
      : Math.min(2, Math.max(1, registeredAgents));

    await emitEvent(tx, topicId, "pact.proposal.approved", agent.id, proposal.section_id as string, { proposalId });

    if (approveCount < requiredApprovals) {
      return { kind: "approved", approveCount, objectCount, requiredApprovals, needsMajority };
    }

    // Merge the proposal — enough approvals gathered
    await tx.execute({
      sql: "UPDATE proposals SET status = 'merged', resolved_at = NOW() WHERE id = ?",
      args: [proposalId],
    });
    // Canonicalize proposals update topics.canonical_claim instead of a section
    if (proposal.proposal_type === "canonicalize") {
      await tx.execute({
        sql: "UPDATE topics SET canonical_claim = ? WHERE id = ?",
        args: [proposal.new_content as string, topicId],
      });
    } else {
      await tx.execute({
        sql: "UPDATE sections SET content = ? WHERE id = ? AND topic_id = ?",
        args: [proposal.new_content as string, proposal.section_id as string, topicId],
      });
    }
    await tx.execute({
      sql: "UPDATE agents SET proposals_approved = proposals_approved + 1 WHERE id = ?",
      args: [proposal.agent_id as string],
    });

    // Return stake + bonus to proposer (5 returned + 5 bonus = 10)
    await transfer(tx, { from: null, to: proposal.agent_id as string, amount: 10, topicId, reason: "proposal-stake-return-plus-bonus" });

    await emitEvent(tx, topicId, "pact.proposal.merged", agent.id, proposal.section_id as string, {
      proposalId,
      approveCount,
      objectCount,
      requiredApprovals,
      policy: needsMajority ? "majority" : "multi-approval",
    });

    return { kind: "merged", approveCount, objectCount, needsMajority };
  });

  if (outcome.kind === "already-voted") {
    return NextResponse.json({ error: "Already voted" }, { status: 409 });
  }

  if (outcome.kind === "merged") {
    const { approveCount, objectCount, needsMajority } = outcome;

    // Evaluate consensus after merge — topics may flip to consensus status.
    // #5599 PR-B (design comment §2, the third disposition): AFTER the
    // request transaction commits, on a dedicated connection-scoped client
    // whose per-decision writes each ride their own short transaction.
    // Never inside the request transaction (a five-phase sweep with a 60s
    // time budget would hold it open for up to a minute), and never on the
    // plain pooled client (whose emitEvent used to mint each chain link in
    // a second transaction; PR-C's interlock refuses it outright).
    await runConsensusStatusUpdate();

    // Audit log (#1308 / MEGA-80 WS5)
    await recordAudit({
      actorKey: agent.id,
      actorLabel: agent.name,
      op: "pact.proposal.approve",
      entityType: "proposal",
      entityId: proposalId,
      after: { topicId, status: "merged", approveCount, objectCount, policy: needsMajority ? "majority" : "multi-approval" },
      requestId: req.headers.get("x-request-id"),
      ipCountry: ipCountryFromHeaders(req.headers),
    });

    return NextResponse.json({
      status: "merged",
      // #5535 §25 surface pass — ADDITIVE (#5564): the vote is on the wire
      // in protocol vocabulary. `recorded: true` states the vote landed;
      // `decision` names the §5 verb this route implements.
      proposalId,
      recorded: true,
      decision: "approve",
      approveCount,
      objectCount,
      policy: needsMajority ? "majority" : "multi-approval",
    });
  }

  // Approved but not enough votes to merge yet
  const { approveCount, objectCount, requiredApprovals, needsMajority } = outcome;
  const remaining = requiredApprovals - approveCount;
  const reason = needsMajority
    ? `Proposal has objections. ${remaining} more approval(s) needed for majority merge.`
    : `${remaining} more approval(s) needed to merge.`;

  // Audit log (#1308 / MEGA-80 WS5)
  await recordAudit({
    actorKey: agent.id,
    actorLabel: agent.name,
    op: "pact.proposal.approve",
    entityType: "proposal",
    entityId: proposalId,
    after: { topicId, status: "approved-pending-merge", approveCount, objectCount, requiredApprovals, remainingApprovals: remaining },
    requestId: req.headers.get("x-request-id"),
    ipCountry: ipCountryFromHeaders(req.headers),
  });

  return NextResponse.json({
    status: "approved",
    // #5535 §25 surface pass — ADDITIVE (#5564), same three fields as the
    // merged branch: the vote is recorded either way.
    proposalId,
    recorded: true,
    decision: "approve",
    approveCount,
    objectCount,
    requiredApprovals,
    remainingApprovals: remaining,
    policy: needsMajority ? "majority" : "multi-approval",
    note: reason,
  });
}
