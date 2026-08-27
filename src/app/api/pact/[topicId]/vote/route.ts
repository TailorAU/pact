import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, finalizeApprovedTopic, finalizeRejectedTopic, getTopicApprovalQuorum, computeTopicVoteTally } from "@/lib/db";
import { usesClassCounting } from "@/lib/independence";
import { requireAgent, checkAgentReputation } from "@/lib/auth";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { v4 as uuid } from "uuid";
import { sanitizeReason, sanitizeContent } from "@/lib/sanitize";
import { recordAudit, ipCountryFromHeaders } from "@/lib/audit";
import { readBodyBounded } from "@/lib/read-body-bounded";

// Canonical tiers for need_info dependency topic creation
const VALID_TIERS = ["axiom", "empirical", "institutional", "interpretive", "conjecture"];

// GET: View current votes on a topic proposal
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  const topic = await db.execute({
    sql: "SELECT id, title, status, tier, created_at FROM topics WHERE id = ?",
    args: [topicId],
  });
  if (!topic.rows[0]) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  // #5459 — post-cutoff topics count DISTINCT independence classes toward
  // quorum (proposer's class excluded, standing-gated); grandfathered
  // topics keep legacy raw counting. Every vote stays visible either way,
  // additively annotated with counted/countedReason/independenceClass.
  const countingMode = usesClassCounting(topic.rows[0].created_at as string | null)
    ? "class-v1"
    : "legacy";
  const tally = await computeTopicVoteTally(db, topicId, countingMode);

  // #5425 — the quorum is tier-based (single-sourced in db.ts) and applies
  // symmetrically to approvals and rejections.
  const quorum = getTopicApprovalQuorum(topic.rows[0].tier as string | null);

  return NextResponse.json({
    topicId,
    status: topic.rows[0].status,
    approvals: tally.approvals,
    rejections: tally.rejections,
    needInfo: tally.needInfo,
    countedApprovals: tally.countedApprovals,
    countedRejections: tally.countedRejections,
    countingMode,
    approvalsNeeded: Math.max(0, quorum - tally.countedApprovals),
    approvalQuorum: quorum,
    rejectionsNeeded: Math.max(0, quorum - tally.countedRejections),
    votes: tally.votes.map((v) => ({
      vote_type: v.voteType,
      reason: v.reason,
      created_at: v.createdAt,
      need_info_topic_id: v.needInfoTopicId,
      agentName: v.agentName,
      counted: v.counted,
      countedReason: v.countedReason,
      independenceClass: v.independenceClass,
    })),
  });
}

// POST: Vote on a topic proposal (approve, reject, or need_info)
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
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { vote, reason, dependencyTitle, dependencyTier } = body;
  if (!vote || !["approve", "reject", "need_info"].includes(vote)) {
    return NextResponse.json(
      { error: "vote is required: 'approve', 'reject', or 'need_info'" },
      { status: 400 }
    );
  }

  // Validate need_info-specific fields
  if (vote === "need_info") {
    if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
      return NextResponse.json(
        { error: "need_info votes require a 'reason' (min 10 characters) explaining what information is needed" },
        { status: 400 }
      );
    }
    if (!dependencyTitle || typeof dependencyTitle !== "string" || dependencyTitle.trim().length < 3) {
      return NextResponse.json(
        { error: "need_info votes require a 'dependencyTitle' (min 3 characters) — the prerequisite knowledge topic" },
        { status: 400 }
      );
    }
  }

  // Sanitize reason if provided
  const cleanReason = reason ? sanitizeReason(reason) : null;
  if (reason && cleanReason && !cleanReason.valid) {
    return NextResponse.json({ error: `reason: ${cleanReason.error}` }, { status: 400 });
  }

  const db = await getDb();

  // Check topic exists and is in "proposed" status
  const topic = await db.execute({
    sql: "SELECT id, title, status, tier, created_at FROM topics WHERE id = ?",
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

  // ─── Handle need_info: create or link dependency topic ─────────────
  let needInfoTopicId: string | null = null;
  let dependencyCreated = false;

  if (vote === "need_info") {
    const cleanTitle = sanitizeContent(dependencyTitle, 500);
    if (!cleanTitle.valid) {
      return NextResponse.json({ error: `dependencyTitle: ${cleanTitle.error}` }, { status: 400 });
    }
    const depTitle = cleanTitle.sanitized!;
    const depTier = dependencyTier && VALID_TIERS.includes(dependencyTier) ? dependencyTier : "empirical";

    // Fuzzy dedup: exact match first, then keyword overlap
    const existing = await db.execute({
      sql: "SELECT id, title FROM topics WHERE LOWER(title) = LOWER(?)",
      args: [depTitle],
    });

    let fuzzyMatchId: string | null = null;

    // If no exact match, check for high keyword overlap to prevent near-dupes
    if (existing.rows.length === 0) {
      const words = depTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w: string) => w.length >= 3);
      if (words.length >= 3) {
        const distinctiveWord = words.sort((a: string, b: string) => b.length - a.length)[0];
        const candidates = await db.execute({
          sql: "SELECT id, title FROM topics WHERE LOWER(title) LIKE ? LIMIT 50",
          args: [`%${distinctiveWord}%`],
        });
        for (const row of candidates.rows) {
          const cWords = (row.title as string).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w: string) => w.length >= 3);
          const overlap = words.filter((w: string) => cWords.includes(w)).length;
          if (overlap / Math.max(words.length, cWords.length) >= 0.75) {
            fuzzyMatchId = row.id as string;
            break;
          }
        }
      }
    }

    if (existing.rows[0] || fuzzyMatchId) {
      // Link to existing topic (exact or fuzzy match)
      needInfoTopicId = fuzzyMatchId || (existing.rows[0].id as string);
    } else {
      // Create new dependency topic in "proposed" status
      needInfoTopicId = uuid();
      const sectionId = uuid();
      await db.execute({
        sql: `INSERT INTO topics (id, title, content, tier, status) VALUES (?, ?, ?, ?, 'proposed')`,
        args: [needInfoTopicId, depTitle, `Dependency surfaced by ${agent.name}: ${cleanReason?.sanitized ?? reason}`, depTier],
      });
      // Create the default "Answer" section
      await db.execute({
        sql: `INSERT INTO sections (id, topic_id, heading, body, sort_order) VALUES (?, ?, 'Answer', 'Awaiting content.', 0)`,
        args: [sectionId, needInfoTopicId],
      });
      dependencyCreated = true;
    }

    // Link: the voted-on topic depends on the dependency topic
    try {
      await db.execute({
        sql: "INSERT INTO topic_dependencies (topic_id, depends_on, relationship) VALUES (?, ?, 'assumes')",
        args: [topicId, needInfoTopicId],
      });
    } catch {
      // Dependency link already exists — that's fine
    }

    // Award credits for surfacing a dependency
    try {
      const { transfer } = await import("@/lib/economy");
      await transfer(db, {
        from: "hub-protocol",
        to: agent.id,
        amount: dependencyCreated ? 5 : 3,
        reason: dependencyCreated ? "dependency-discovery-new" : "dependency-discovery-link",
        topicId,
      });
    } catch {
      // Economy not critical
    }
  }

  // Cast vote (unique per agent per topic)
  const voteId = uuid();
  try {
    await db.execute({
      sql: "INSERT INTO topic_votes (id, topic_id, agent_id, vote_type, reason, need_info_topic_id) VALUES (?, ?, ?, ?, ?, ?)",
      args: [voteId, topicId, agent.id, vote, cleanReason?.sanitized ?? null, needInfoTopicId],
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
    ...(needInfoTopicId ? { dependencyTopicId: needInfoTopicId, dependencyCreated } : {}),
  });

  // need_info votes do NOT count toward approval threshold — only approve/reject
  if (vote === "need_info") {
    return NextResponse.json({
      topicId,
      vote,
      needInfoTopicId,
      dependencyCreated,
      message: dependencyCreated
        ? `Vote recorded. Created new dependency topic "${dependencyTitle}" and linked it. +5 credits.`
        : `Vote recorded. Linked existing topic as dependency. +3 credits.`,
    }, { status: 200 });
  }

  // #5425 — tally both decisive vote kinds against the SAME tier-based
  // quorum (single-sourced in db.ts; replaces the duplicated flat 3).
  // #5459 — quorum satisfaction on post-cutoff topics counts DISTINCT
  // independence classes (proposer's class excluded, standing-gated);
  // grandfathered topics (created before the cutoff) keep raw counting.
  const quorum = getTopicApprovalQuorum(topic.rows[0].tier as string | null);
  const countingMode = usesClassCounting(topic.rows[0].created_at as string | null)
    ? "class-v1"
    : "legacy";
  let approvals: number;
  let rejections: number;
  let countedApprovals: number;
  let countedRejections: number;
  if (countingMode === "class-v1") {
    const tally = await computeTopicVoteTally(db, topicId, countingMode);
    approvals = tally.approvals;
    rejections = tally.rejections;
    countedApprovals = tally.countedApprovals;
    countedRejections = tally.countedRejections;
  } else {
    const approvalCount = await db.execute({
      sql: "SELECT COUNT(*) as c FROM topic_votes WHERE topic_id = ? AND vote_type = 'approve'",
      args: [topicId],
    });
    approvals = (approvalCount.rows[0].c as number) || 0;
    const rejectCount = await db.execute({
      sql: "SELECT COUNT(*) as c FROM topic_votes WHERE topic_id = ? AND vote_type = 'reject'",
      args: [topicId],
    });
    rejections = (rejectCount.rows[0].c as number) || 0;
    countedApprovals = approvals;
    countedRejections = rejections;
  }

  // Race rule (#5425): approval is checked FIRST — when both quorums are
  // met in the same tally, approval wins, because an opened topic is still
  // recoverable (challenges, demotion) while 'rejected' is terminal.
  if (countedApprovals >= quorum) {
    // Topic is approved — run the SAME quorum transition as the sweep
    // (evaluateTopicProposals): legislation proposals auto-ingest and go to
    // 'consensus'; everything else opens for debate. Previously this branch
    // flipped the topic straight to 'open', which silently bypassed the
    // legislation auto-ingest (#5277 / pact#56).
    const outcome = await finalizeApprovedTopic(
      db,
      topicId,
      topic.rows[0].title as string,
      countedApprovals,
      quorum
    );
    if (outcome !== "skipped") {
      const newStatus = outcome === "ingested" ? "consensus" : "open";

      // Audit log (#1308 / MEGA-80 WS5)
      await recordAudit({
        actorKey: agent.id,
        actorLabel: agent.name,
        op: "pact.vote.cast",
        entityType: "vote",
        entityId: topicId,
        after: { topicId, vote, approvals, countedApprovals, countingMode, status: newStatus, topicOpened: true },
        requestId: req.headers.get("x-request-id"),
        ipCountry: ipCountryFromHeaders(req.headers),
      });

      return NextResponse.json({
        topicId,
        vote,
        approvals,
        countedApprovals,
        countedRejections,
        countingMode,
        status: newStatus,
        message: outcome === "ingested"
          ? `Topic approved with ${countedApprovals} counting votes! Legislation ingested — the document is now citable.`
          : `Topic approved with ${countedApprovals} counting votes! It is now open for debate.`,
      }, { status: 200 });
    }
    // "skipped": the topic left 'proposed' concurrently — fall through to
    // the vote-recorded response with the live status.
  } else if (countedRejections >= quorum) {
    // #5425 — first-class rejection: reject quorum reached before approval
    // quorum. Terminal; rejected legislation proposals never ingest.
    const transitioned = await finalizeRejectedTopic(
      db,
      topicId,
      topic.rows[0].title as string,
      countedRejections,
      quorum
    );
    if (transitioned) {
      // Audit log (#1308 / MEGA-80 WS5)
      await recordAudit({
        actorKey: agent.id,
        actorLabel: agent.name,
        op: "pact.vote.cast",
        entityType: "vote",
        entityId: topicId,
        after: { topicId, vote, approvals, rejections, countedRejections, countingMode, status: "rejected", topicOpened: false },
        requestId: req.headers.get("x-request-id"),
        ipCountry: ipCountryFromHeaders(req.headers),
      });

      return NextResponse.json({
        topicId,
        vote,
        approvals,
        rejections,
        countedApprovals,
        countedRejections,
        countingMode,
        status: "rejected",
        message: `Topic rejected with ${countedRejections} counting reject votes (quorum ${quorum}). This is terminal — it will not open or ingest.`,
      }, { status: 200 });
    }
    // Not transitioned: the topic left 'proposed' concurrently — fall
    // through to the vote-recorded response with the live status.
  }

  // Audit log (#1308 / MEGA-80 WS5)
  await recordAudit({
    actorKey: agent.id,
    actorLabel: agent.name,
    op: "pact.vote.cast",
    entityType: "vote",
    entityId: topicId,
    after: { topicId, vote, approvals, rejections, countedApprovals, countedRejections, countingMode, status: "proposed", topicOpened: false },
    requestId: req.headers.get("x-request-id"),
    ipCountry: ipCountryFromHeaders(req.headers),
  });

  return NextResponse.json({
    topicId,
    vote,
    approvals,
    rejections,
    countedApprovals,
    countedRejections,
    countingMode,
    approvalsNeeded: Math.max(0, quorum - countedApprovals),
    rejectionsNeeded: Math.max(0, quorum - countedRejections),
    status: "proposed",
    message: `Vote recorded. ${Math.max(0, quorum - countedApprovals)} more counting approval(s) needed to open this topic.`,
  }, { status: 200 });
}
