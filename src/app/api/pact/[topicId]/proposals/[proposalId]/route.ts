import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { log } from "@/lib/logger";
import {
  attestationAbsence,
  consensusReachedFor,
  executionStateFor,
  mergedByFor,
  proposalProtocolStatus,
  type MergeProvenance,
} from "@/lib/protocol-surface";
import { topicEffectClassification } from "@/lib/protocol-surface";

export const dynamic = "force-dynamic";

// GET /api/pact/{topicId}/proposals/{proposalId} — single-proposal read
// (#5535 §25 surface pass).
//
// The proposal directory served only the collection plus the three verb
// routes (approve / object / reject); the resource itself had no read, so
// the execution-boundary session vectors' "GET the proposal back" step
// 404'd against the KG (#5535 HOLD, criterion 2). This is that read.
//
// Like every other read here it is public and unauthenticated, it never
// runs the consensus engine (#5425 — the advisory-locked cron sweep is the
// sole invoker), and it opens no transaction (#5599's wrap is for mutating
// regions; this route writes nothing).
//
// The response carries BOTH vocabularies:
//   - the KG's own row fields (`kg_status`, `sectionId`, counts…), and
//   - the §25 protocol rendering the vectors match on — `status` in §5
//     vocabulary, `merged_by` (§25.3: never a principal for an unsigned
//     merge), `effect_class` / `human_attestation` resolved through the
//     §25.6 guard's own resolver, `execution_state` (§25.8), and the §25.4
//     attestation-absence block (`attested: false`,
//     `authorization_proof: null`, empty collections) — see
//     `src/lib/protocol-surface.ts`.
//
// Merge provenance (auto-merge vs vote quorum) is read from the event log.
// Both derivations are additive and total: a merged row whose merge events
// were purged by retention serves `merged_by: null` — stated absence, not a
// reconstruction (§25.4) — and an event-store failure degrades to the same
// rather than a 500.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topicId: string; proposalId: string }> }
) {
  const { topicId, proposalId } = await params;
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT p.id, p.topic_id, p.section_id as sectionId, p.status, p.summary,
        p.created_at, p.resolved_at, p.ttl_seconds as ttl, p.citations,
        p.confidential, p.public_summary, p.proposal_type as proposalType,
        p.defeater_type as defeaterType,
        a.name as authorName, p.agent_id as authorId,
        t.status as topicStatus,
        (SELECT COUNT(*) FROM votes v WHERE v.proposal_id = p.id AND v.vote_type = 'approve') as approveCount,
        (SELECT COUNT(*) FROM votes v WHERE v.proposal_id = p.id AND v.vote_type = 'object') as objectCount
      FROM proposals p
      JOIN topics t ON t.id = p.topic_id
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.id = ? AND p.topic_id = ?`,
    args: [proposalId, topicId],
  });
  const row = result.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Merge provenance from the event log — the auto-merge sweep emits
  // pact.proposal.auto-merged, the approve route's quorum merge emits
  // pact.proposal.merged, and both stamp the proposalId into the payload.
  let provenance: MergeProvenance = null;
  if (row.status === "merged") {
    try {
      const events = await db.execute({
        sql: `SELECT type, data FROM events
          WHERE topic_id = ? AND type IN ('pact.proposal.auto-merged', 'pact.proposal.merged')
          ORDER BY created_at DESC`,
        args: [topicId],
      });
      for (const event of events.rows) {
        let payload: { proposalId?: unknown } = {};
        try {
          payload = JSON.parse(String(event.data ?? "{}"));
        } catch {
          continue;
        }
        if (payload.proposalId === proposalId) {
          provenance = event.type === "pact.proposal.auto-merged" ? "auto" : "votes";
          break;
        }
      }
    } catch (e) {
      // Additive degradation: a failed provenance read must not take down
      // the resource read. merged_by stays null — stated absence (§25.4).
      log.warn(
        { op: "pact.proposal.provenance.warn", topicId, proposalId, err: e },
        "merge-provenance sub-query failed (non-fatal)"
      );
      provenance = null;
    }
  }

  const kgStatus = String(row.status);
  const consensusReached = consensusReachedFor(row.topicStatus as string);

  // Confidential redaction — the same rule the collection route applies:
  // summary/citations are replaced by the public summary; provenance of the
  // text stays sealed, the §25 state does not (it is protocol state).
  const redacted = row.confidential
    ? { summary: row.public_summary || "[Confidential proposal]", citations: null }
    : { summary: row.summary, citations: row.citations };

  return NextResponse.json({
    proposalId: row.id,
    id: row.id,
    topicId: row.topic_id,
    sectionId: row.sectionId,
    // §5 protocol vocabulary. The internal column value stays served,
    // unrenamed, as kg_status (#5564 — additive only).
    status: proposalProtocolStatus(kgStatus, provenance),
    kg_status: kgStatus,
    merged_by: mergedByFor(kgStatus, provenance),
    // §25.5 — resolved through the apply guard's own resolver.
    ...topicEffectClassification(),
    // §25.8 — none / unexecuted; signed and executed are unreachable here.
    execution_state: executionStateFor(consensusReached),
    // §25.4 — attested: false, authorization_proof: null, empty collections.
    ...attestationAbsence(),
    ...redacted,
    proposalType: row.proposalType,
    defeaterType: row.defeaterType,
    confidential: !!row.confidential,
    authorName: row.authorName,
    authorId: row.authorId,
    ttl: row.ttl,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    approveCount: Number(row.approveCount ?? 0),
    objectCount: Number(row.objectCount ?? 0),
  });
}
