import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { warrantKindFromTier, consensusStateFor, credenceFromRatio } from "@/lib/epistemic";
import {
  consensusReachedFor,
  documentStateFor,
  executionAbsence,
  executionStateFor,
  topicEffectClassification,
  topicPhaseFor,
} from "@/lib/protocol-surface";

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

  // #5425 — reads never run the consensus engine (it used to be invoked
  // here); the advisory-locked cron sweep (/api/cron/auto-merge,
  // /api/cron/cleanup) is the sole invoker.

  const topicResult = await db.execute({
    sql: `SELECT t.id, t.title, t.content, t.tier, t.status, t.created_at,
      t.consensus_ratio, t.consensus_since, t.consensus_voters, t.canonical_claim,
      t.claim_support, t.claim_atomicity_status, t.convention_stop, t.credence,
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
        p.proposal_type as proposalType, p.defeater_type as defeaterType,
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

  const consensusReached = consensusReachedFor(topic.status as string);
  // Case-tolerant read of the SELECT's own alias: pgify quotes camelCase
  // aliases on real Postgres, while older mocks may hand back lowercase.
  const topicRow = topic as Record<string, unknown>;
  const mergedCount = Number(topicRow.mergedCount ?? topicRow.mergedcount ?? 0);

  return NextResponse.json({
    ...topic,
    // Axis A + Axis B (#3691): unordered warrant kind; user-facing state;
    // credence = asymptotic transform of the honest ratio (stored effective
    // value wins once the consensus sweep has written it — attenuated
    // transitively by defeated dependencies, never 1.0 by construction).
    warrantKind: warrantKindFromTier(topic.tier as string),
    conventionStop: !!topic.convention_stop,
    state: consensusStateFor(topic.status as string),
    credence: (topic.credence as number | null) ?? credenceFromRatio(topic.consensus_ratio as number | null),
    // #5535 §25 surface pass — ADDITIVE (#5564: nothing above is renamed,
    // removed or re-typed; every field below derives from columns already
    // selected — no backfill, no null-500s). This read is the KG's §25
    // status/export surface, so it speaks protocol vocabulary alongside the
    // product fields: the §25.5 classification through the apply guard's own
    // resolver, the §25.8 execution state (the forbidden execution labels
    // are unreachable — EXECUTION_CAPABILITY is false), the §25.3 document
    // state (a merged draft is `merged`, never more), the §25.11
    // enforceability non-determination, and the §25.8 signature absence the
    // execution-boundary vectors' negative obligations require to be
    // REPORTED, not elided. See src/lib/protocol-surface.ts.
    fabric_id: topic.id,
    ...topicEffectClassification(),
    consensus_reached: consensusReached,
    phase: topicPhaseFor(topic.status as string),
    document_state: documentStateFor(mergedCount),
    execution_state: executionStateFor(consensusReached),
    legal_status: null,
    ...executionAbsence(),
    proposals,
    votes,
  });
}
