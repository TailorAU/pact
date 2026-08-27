import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { requireAgent, checkReviewDuty } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { sanitizeContent, sanitizeSummary, validateTTL } from "@/lib/sanitize";
import { transfer, ensureWallet } from "@/lib/economy";
import { recordAudit, ipCountryFromHeaders } from "@/lib/audit";
import { readBodyBounded } from "@/lib/read-body-bounded";
import { VERIFIED_TOPIC_STATUSES } from "@/lib/consensus-gate";
import { validateDefeater, challengeSimilarity, CHALLENGE_COALESCE_THRESHOLD } from "@/lib/epistemic";
import { CANONICAL_CLAIM_MAX, lintAtomicClaim } from "@/lib/claim";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50"), 200);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

  const db = await getDb();
  // #5425 — reads never run the consensus engine; the cron sweep is the
  // sole invoker.

  const result = await db.execute({
    sql: `SELECT p.id, p.section_id as sectionId, p.status, p.summary, p.created_at,
           p.ttl_seconds as ttl, a.name as authorName, p.agent_id as authorId,
           p.citations, p.confidential, p.public_summary, p.proposal_type as proposalType,
           p.defeater_type as defeaterType,
           (SELECT COUNT(*) FROM votes v WHERE v.proposal_id = p.id AND v.vote_type = 'approve') as approveCount,
           (SELECT COUNT(*) FROM votes v WHERE v.proposal_id = p.id AND v.vote_type = 'object') as objectCount
    FROM proposals p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.topic_id = ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?`,
    args: [topicId, limit, offset],
  });

  // Redact confidential proposals — replace summary/citations with public_summary
  const rows = result.rows.map((row) => {
    if (row.confidential) {
      return {
        ...row,
        summary: row.public_summary || "[Confidential proposal]",
        citations: null,
      };
    }
    return row;
  });

  return NextResponse.json(rows);
}

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

  // Review duty gate — agents must review pending proposals before submitting new ones
  const review = await checkReviewDuty(agent.id);
  if (!review.allowed) {
    return NextResponse.json({
      error: `Review duty: you must approve or object to ${review.reviewsNeeded} more pending proposal(s) before submitting your own. You've made ${review.proposalsMade} proposal(s) but only reviewed ${review.reviewsCast} from others.`,
      reviewsNeeded: review.reviewsNeeded,
      proposalsMade: review.proposalsMade,
      reviewsCast: review.reviewsCast,
      hint: "GET /api/pact/{topicId}/proposals to find pending proposals, then POST /api/pact/{topicId}/proposals/{proposalId}/approve or /reject",
    }, { status: 403 });
  }

  let body;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { sectionId, newContent, summary, ttl, citations, confidential, publicSummary, proposalType, defeaterType } = body;
  const isConfidential = confidential ? 1 : 0;
  const cleanPublicSummary = publicSummary ? String(publicSummary).slice(0, 500) : null;

  // Validate proposal type. "challenge" (#3691 W4) explicitly attacks a
  // claim in any post-open verified state — consensus, stable, or locked.
  const VALID_PROPOSAL_TYPES = ["edit", "canonicalize", "challenge"];
  const cleanProposalType = proposalType && VALID_PROPOSAL_TYPES.includes(proposalType) ? proposalType : "edit";
  const isCanonicalize = cleanProposalType === "canonicalize";
  const wantsChallenge = cleanProposalType === "challenge";

  if (isCanonicalize || wantsChallenge) {
    // Canonicalize proposals target topics.canonical_claim; challenges
    // attack the whole claim — neither requires a sectionId.
    if (!newContent || !summary) {
      return NextResponse.json({ error: `newContent and summary are required for ${cleanProposalType} proposals` }, { status: 400 });
    }
  } else if (!sectionId || !newContent || !summary) {
    return NextResponse.json({ error: "sectionId, newContent, and summary are required" }, { status: 400 });
  }

  // Forward-only atomic-claim enforcement on claim EDITS (#3691 W2/W6):
  // a canonicalize proposal is an edit of canonical_claim, so it takes the
  // same cap + lint as creation. Legacy long claims stay untouched until a
  // canonicalize proposal replaces them.
  if (isCanonicalize) {
    if (String(newContent).length > CANONICAL_CLAIM_MAX) {
      return NextResponse.json({
        error: `A canonical claim must be at most ${CANONICAL_CLAIM_MAX} characters (got ${String(newContent).length}).`,
        hint: "Externalize conditions to `assumes` edges and scope fields rather than compressing them away.",
      }, { status: 422 });
    }
    const lint = lintAtomicClaim(String(newContent));
    if (!lint.ok) {
      return NextResponse.json({ error: lint.error, ...(lint.hint ? { hint: lint.hint } : {}) }, { status: 422 });
    }
  }

  // Sanitize content — strip HTML, null bytes, enforce length limits
  const contentResult = sanitizeContent(newContent);
  if (!contentResult.valid) {
    return NextResponse.json({ error: `newContent: ${contentResult.error}` }, { status: 400 });
  }

  // Content quality check — reject meta-commentary and empty proposals.
  // Canonicalize proposals are exempt from the 50-char floor: an atomic
  // canonical claim ("Water boils at 100 °C") is legitimately short.
  if (!isCanonicalize && contentResult.sanitized.length < 50) {
    return NextResponse.json({ error: "Proposals must contain substantive content (at least 50 characters). Write a real answer, not a placeholder." }, { status: 400 });
  }
  if (/^\[Proposed by/i.test(contentResult.sanitized)) {
    return NextResponse.json({ error: "Proposals must contain substantive content, not meta-commentary. Write the actual answer you want to see in this section." }, { status: 400 });
  }

  // Validate citations (optional) — array of { topicId, excerpt }
  let citationsJson: string | null = null;
  if (citations && Array.isArray(citations)) {
    const validCitations = citations.filter(
      (c: { topicId?: string; excerpt?: string }) => c.topicId && typeof c.topicId === "string" && c.excerpt && typeof c.excerpt === "string"
    ).slice(0, 10); // Max 10 citations
    if (validCitations.length > 0) {
      citationsJson = JSON.stringify(validCitations);
    }
  }
  const summaryResult = sanitizeSummary(summary);
  if (!summaryResult.valid) {
    return NextResponse.json({ error: `summary: ${summaryResult.error}` }, { status: 400 });
  }

  // Validate TTL bounds (min 30s, max 86400s)
  const ttlResult = validateTTL(ttl);
  if (!ttlResult.valid) {
    return NextResponse.json({ error: ttlResult.error }, { status: 400 });
  }

  const db = await getDb();

  // Check topic status — locked topics only accept challenges, proposed topics block proposals
  const topicCheck = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [topicId] });
  if (!topicCheck.rows[0]) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  const topicStatus = topicCheck.rows[0].status as string;

  if (topicStatus === "proposed") {
    return NextResponse.json(
      { error: "This topic is still a proposal awaiting approval. Vote on it at POST /api/pact/{topicId}/vote before it can accept content proposals." },
      { status: 403 }
    );
  }

  // #5425 — 'rejected' is terminal: a rejected topic never opens, never
  // ingests, and accepts no content proposals (which could otherwise be
  // auto-merged into it by the sweep).
  if (topicStatus === "rejected") {
    return NextResponse.json(
      { error: "This topic proposal was rejected by community vote. Rejected topics are terminal and accept no content proposals." },
      { status: 403 }
    );
  }

  // #3691 W4: challenge reachability covers EVERY post-open verified state
  // (consensus/stable/locked) — including convention-stop nodes, which are
  // ordinary topics on Axis B. A proposal against a locked topic still
  // auto-becomes a challenge; consensus/stable are challenged explicitly
  // via proposalType: "challenge".
  const isVerifiedState = (VERIFIED_TOPIC_STATUSES as readonly string[]).includes(topicStatus);
  const isLocked = topicStatus === "locked";
  if (wantsChallenge && !isVerifiedState) {
    return NextResponse.json({
      error: `Only claims in a post-open verified state (${VERIFIED_TOPIC_STATUSES.join(", ")}) can be challenged. This topic is '${topicStatus}' — submit an ordinary proposal instead.`,
    }, { status: 400 });
  }
  const isChallenge = isLocked || (wantsChallenge && isVerifiedState);

  if (isChallenge) {
    // Typed defeater + minimum-substance gate (#3691 W4) — modelled on the
    // first-principles dependency gate. The cost of challenging scales;
    // the affordance never disappears.
    const defeater = validateDefeater(defeaterType, String(summary ?? ""));
    if (!defeater.valid) {
      return NextResponse.json({ error: defeater.error, ...(defeater.hint ? { hint: defeater.hint } : {}) }, { status: 422 });
    }

    // Coalesce near-identical open defeaters into one thread (anti-brigade):
    // support the existing challenge instead of fragmenting it.
    const openChallenges = await db.execute({
      sql: "SELECT id, summary FROM proposals WHERE topic_id = ? AND status = 'challenge'",
      args: [topicId],
    });
    for (const existing of openChallenges.rows) {
      if (challengeSimilarity(String(existing.summary ?? ""), String(summary)) >= CHALLENGE_COALESCE_THRESHOLD) {
        return NextResponse.json({
          error: "A near-identical challenge is already open on this claim — challenges coalesce into one thread.",
          existingChallengeId: existing.id,
          hint: `Add your support instead: POST /api/pact/${topicId}/proposals/${existing.id}/approve`,
        }, { status: 409 });
      }
    }
  }

  // Verify section exists (skip for canonicalize/challenge proposals which target the claim itself)
  const effectiveSectionId = isCanonicalize ? `sec:canonical-${topicId}` : (wantsChallenge && !sectionId ? `sec:challenge-${topicId}` : sectionId);
  if (!isCanonicalize && !(wantsChallenge && !sectionId)) {
    const sectionResult = await db.execute({ sql: "SELECT id FROM sections WHERE id = ? AND topic_id = ?", args: [sectionId, topicId] });
    if (!sectionResult.rows[0]) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
  }

  // Canonicalize proposals use a shorter default TTL (2 min) for quick turnaround
  const effectiveTtl = isCanonicalize && !ttl ? 120 : ttlResult.value;

  // Stake-to-propose: skin in the game (5 credits)
  await ensureWallet(db, agent.id);
  const walletResult = await db.execute({
    sql: "SELECT balance FROM agent_wallets WHERE agent_id = ?",
    args: [agent.id],
  });
  const balance = (walletResult.rows[0]?.balance as number) || 0;
  if (balance < 5) {
    return NextResponse.json({
      error: `Insufficient credits to propose. Proposals require a 5-credit stake. Current balance: ${balance}. Earn credits by creating topics (+5), reviewing proposals (+1), or aligning with consensus (+2).`,
    }, { status: 403 });
  }
  await transfer(db, { from: agent.id, to: "hub-protocol", amount: 5, topicId, reason: "proposal-stake" });

  const proposalId = uuid();
  const proposalStatus = isChallenge ? "challenge" : "pending";
  await db.execute({
    sql: "INSERT INTO proposals (id, topic_id, section_id, agent_id, new_content, summary, ttl_seconds, status, citations, confidential, public_summary, proposal_type, defeater_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [proposalId, topicId, effectiveSectionId, agent.id, contentResult.sanitized, summaryResult.sanitized, effectiveTtl, proposalStatus, citationsJson, isConfidential, cleanPublicSummary, cleanProposalType, isChallenge ? (defeaterType as string) : null],
  });

  await db.execute({
    sql: "UPDATE agents SET proposals_made = proposals_made + 1 WHERE id = ?",
    args: [agent.id],
  });

  const eventType = isChallenge ? "pact.consensus.challenged" : "pact.proposal.created";
  await emitEvent(db, topicId, eventType, agent.id, effectiveSectionId ?? undefined, {
    proposalId,
    summary: isConfidential ? (cleanPublicSummary || "[Confidential proposal]") : summaryResult.sanitized,
    ...(isChallenge ? { defeaterType } : {}),
    ...(isConfidential ? { confidential: true } : {}),
  });

  // Audit log (#1308 / MEGA-80 WS5)
  await recordAudit({
    actorKey: agent.id,
    actorLabel: agent.name,
    op: "pact.proposal.create",
    entityType: "proposal",
    entityId: proposalId,
    after: {
      topicId,
      sectionId: effectiveSectionId,
      proposalType: cleanProposalType,
      status: proposalStatus,
      isLocked,
      confidential: !!isConfidential,
    },
    requestId: req.headers.get("x-request-id"),
    ipCountry: ipCountryFromHeaders(req.headers),
  });

  return NextResponse.json({
    id: proposalId,
    sectionId: effectiveSectionId,
    proposalType: cleanProposalType,
    status: proposalStatus,
    summary: summaryResult.sanitized,
    ...(isChallenge ? { defeaterType } : {}),
    confidential: !!isConfidential,
    ...(isChallenge ? { note: "This topic has achieved consensus. Your proposal is filed as a CHALLENGE. If enough agents support it (the bar scales with how many claims depend on this one), the topic will be reopened for debate. Substantive challenges get their stake back even when they lose." } : {}),
    ...(isConfidential ? { warning: "Note: If this proposal is merged, new_content becomes public section text. Only provenance (who wrote it, reasoning, citations) stays sealed." } : {}),
  }, { status: 201 });
}
