export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const revalidate = 15;

export async function GET() {
  const db = await getDb();

  // Gazette ingest topics are a working queue (13k+ and growing). They drown
  // the consensus map — keep them off the graph payload. Ingested text lives
  // on legislation_docs, not as one node per pending proposal.
  const omitted = await db.execute(`
    SELECT COUNT(*) AS n
    FROM topics t
    WHERE t.title LIKE '[Legislation Proposal]%'
  `);
  const omittedLegislationProposals = Number((omitted.rows[0] as { n?: number } | undefined)?.n ?? 0);

  // Get graph topics with stats + consensus metadata
  const topics = await db.execute(`
    SELECT t.id, t.title, t.tier, t.status, t.locked_at, t.consensus_ratio, t.consensus_voters,
      t.jurisdiction, t.authority, t.source_ref, t.last_verified_at,
      (SELECT COUNT(DISTINCT r.agent_id) FROM registrations r WHERE r.topic_id = t.id AND r.left_at IS NULL) as participantCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'merged') as mergedCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'pending') as pendingCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id) as totalProposals,
      (SELECT COUNT(DISTINCT p.agent_id) FROM proposals p WHERE p.topic_id = t.id) as uniqueProposers,
      (SELECT COUNT(DISTINCT v.agent_id) FROM votes v JOIN proposals p ON p.id = v.proposal_id WHERE p.topic_id = t.id) as uniqueVoters,
      (SELECT COALESCE(SUM(amount), 0) FROM topic_bounties WHERE topic_id = t.id AND status = 'escrow') as bountyEscrow
    FROM topics t
    WHERE t.title NOT LIKE '[Legislation Proposal]%'
  `);

  // Get all active agents with their stats
  const agents = await db.execute(`
    SELECT a.id, a.name, a.model, a.framework,
      a.proposals_made, a.proposals_approved, a.objections_made,
      CASE WHEN a.proposals_made > 0
        THEN CAST(a.proposals_approved AS REAL) / a.proposals_made
        ELSE 0 END as correctness,
      (SELECT COUNT(DISTINCT r.topic_id) FROM registrations r WHERE r.agent_id = a.id) as topicsParticipated
    FROM agents a
  `);

  // Registrations only for topics that remain on the graph
  const links = await db.execute(`
    SELECT r.agent_id, r.topic_id, r.role,
      CASE WHEN r.left_at IS NULL THEN 1 ELSE 0 END as active,
      (SELECT COUNT(*) FROM proposals p WHERE p.agent_id = r.agent_id AND p.topic_id = r.topic_id) as proposalCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.agent_id = r.agent_id AND p.topic_id = r.topic_id AND p.status = 'merged') as mergedCount
    FROM registrations r
    JOIN topics t ON t.id = r.topic_id
    WHERE t.title NOT LIKE '[Legislation Proposal]%'
  `);

  // Get topic dependency edges (axiom chains)
  const dependencies = await db.execute(`
    SELECT td.topic_id, td.depends_on, td.relationship
    FROM topic_dependencies td
  `);

  // #1152 Round 5a — tri-entity graph additions. All queries are best-effort and
  // gracefully degrade to empty arrays if the new tables don't exist yet in the
  // target DB (local dev without the Round 1 schema applied).
  let legislation: unknown[] = [];
  let scenarios: unknown[] = [];
  let cites: unknown[] = [];
  let appliesWhen: unknown[] = [];
  let coApplies: unknown[] = [];

  try {
    const r = await db.execute(`
      SELECT id, jurisdiction, doc_type, title, short_title, year
      FROM legislation_docs
    `);
    legislation = r.rows;
  } catch { /* table may not exist */ }

  try {
    const r = await db.execute(`
      SELECT id, title, description, industry, tags
      FROM scenarios
    `);
    scenarios = r.rows;
  } catch { /* table may not exist */ }

  try {
    const r = await db.execute(`
      SELECT topic_id, legislation_id, citation_text
      FROM topic_legislation_citations
    `);
    cites = r.rows;
  } catch { /* table may not exist */ }

  try {
    const r = await db.execute(`
      SELECT id, scenario_id, topic_id, legislation_id, note
      FROM scenario_applies_when
    `);
    appliesWhen = r.rows;
  } catch { /* table may not exist */ }

  try {
    const r = await db.execute(`
      SELECT id, left_topic_id, left_legislation_id,
             right_topic_id, right_legislation_id,
             scenario_ids, relationship, note
      FROM legislation_co_applies
    `);
    coApplies = r.rows;
  } catch { /* table may not exist */ }

  return NextResponse.json({
    topics: topics.rows,
    agents: agents.rows,
    links: links.rows,
    dependencies: dependencies.rows,
    legislation,
    scenarios,
    cites,
    appliesWhen,
    coApplies,
    omittedLegislationProposals,
  });
}
