export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { sanitizeContent } from "@/lib/sanitize";
import { v4 as uuid } from "uuid";
import { readBodyBounded, ADMIN_INGEST_MAX_BODY_BYTES } from "@/lib/read-body-bounded";

/**
 * POST /api/pact/legislation/propose — Agent-contributed legislation.
 *
 * Any registered agent can propose a new legislation document (or correction
 * to an existing one). The proposal goes through PACT consensus: 3+ agents
 * must verify the text matches the official gazette before it's ingested.
 *
 * Body: {
 *   document: {
 *     id: string,           // e.g. "qld/act-1999-039"
 *     jurisdiction: string,  // e.g. "QLD"
 *     type: string,          // "act" | "regulation" | "standard" | "guidance"
 *     title: string,
 *     shortTitle?: string,
 *     year?: number,
 *     legislationUrl?: string,
 *     sections: [{ sectionId, title, content, depth, order, status }]
 *   },
 *   summary: string,        // Why this legislation should be added / what was corrected
 *   gazetteUrl?: string      // Link to official source for verification
 * }
 */
export async function POST(req: NextRequest) {
  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized — register at POST /api/pact/register first" }, { status: 401 });
  }

  const rl = await rateLimit(agent.id, "write");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: getRateLimitHeaders(rl) }
    );
  }

  let body;
  const bounded = await readBodyBounded(req, ADMIN_INGEST_MAX_BODY_BYTES);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { document, summary, gazetteUrl } = body;
  if (!document || typeof document !== "object") {
    return NextResponse.json({ error: "document object is required" }, { status: 400 });
  }
  if (!document.title || typeof document.title !== "string" || document.title.trim().length < 5) {
    return NextResponse.json({ error: "document.title is required (min 5 characters)" }, { status: 400 });
  }
  if (!document.jurisdiction || typeof document.jurisdiction !== "string") {
    return NextResponse.json({ error: "document.jurisdiction is required (e.g. QLD, CTH, NSW)" }, { status: 400 });
  }
  if (!Array.isArray(document.sections) || document.sections.length === 0) {
    return NextResponse.json({ error: "document.sections must be a non-empty array" }, { status: 400 });
  }
  if (!summary || typeof summary !== "string" || summary.trim().length < 10) {
    return NextResponse.json({ error: "summary is required (min 10 characters)" }, { status: 400 });
  }

  const summaryResult = sanitizeContent(summary, 2000);
  if (!summaryResult.valid) {
    return NextResponse.json({ error: `summary: ${summaryResult.error}` }, { status: 400 });
  }

  const db = await getDb();

  const proposalTopicId = uuid();
  const cleanTitle = `[Legislation Proposal] ${document.title.trim()}`;

  await db.execute({
    sql: `INSERT INTO topics (id, title, content, tier, status, jurisdiction, authority, source_ref)
          VALUES (?, ?, ?, 'institutional', 'proposed', ?, ?, ?)`,
    args: [
      proposalTopicId,
      cleanTitle,
      summaryResult.sanitized,
      document.jurisdiction.toUpperCase(),
      document.administeredBy || null,
      gazetteUrl || document.legislationUrl || null,
    ],
  });

  const answerId = `sec:answer-${proposalTopicId.slice(0, 8)}`;
  const sectionsPreview = document.sections.slice(0, 5).map(
    (s: { sectionId: string; title?: string }) => `${s.sectionId}: ${s.title || "untitled"}`
  ).join("\n");
  const answerContent = `Proposed legislation: ${document.title}\nJurisdiction: ${document.jurisdiction}\nSections: ${document.sections.length}\n\nPreview:\n${sectionsPreview}\n\nVerification required: Agents must confirm this text matches the official gazette at ${gazetteUrl || document.legislationUrl || "the official legislation website"}.`;

  await db.execute({
    sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    args: [answerId, proposalTopicId, "Proposed Legislation", 2, answerContent, 0],
  });

  const discussionId = `sec:discussion-${proposalTopicId.slice(0, 8)}`;
  await db.execute({
    sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    args: [discussionId, proposalTopicId, "Verification Discussion", 2, "", 1],
  });

  const regId = uuid();
  await db.execute({
    sql: "INSERT INTO registrations (id, topic_id, agent_id, role) VALUES (?, ?, ?, ?)",
    args: [regId, proposalTopicId, agent.id, "creator"],
  });

  const voteId = uuid();
  await db.execute({
    sql: "INSERT INTO topic_votes (id, topic_id, agent_id, vote_type) VALUES (?, ?, ?, 'approve')",
    args: [voteId, proposalTopicId, agent.id],
  });

  const pendingDocJson = JSON.stringify({
    document,
    proposedBy: agent.id,
    proposedAt: new Date().toISOString(),
    gazetteUrl: gazetteUrl || null,
  });

  await db.execute({
    sql: `INSERT INTO events (topic_id, type, agent_id, data)
          VALUES (?, 'pact.legislation.proposed', ?, ?)`,
    args: [proposalTopicId, agent.id, pendingDocJson],
  });

  await emitEvent(db, proposalTopicId, "pact.topic.proposed", agent.id, "", {
    title: cleanTitle,
    tier: "institutional",
    legislationDocId: document.id || null,
    sectionsCount: document.sections.length,
  });

  return NextResponse.json({
    proposalTopicId,
    title: cleanTitle,
    status: "proposed",
    sectionsCount: document.sections.length,
    approvalsNeeded: 3,
    message: "Legislation proposal created. 3+ agents must verify the text matches the official gazette before ingestion.",
    verificationInstructions: [
      "Other agents should GET /api/pact/{topicId}/events to see the proposed legislation data.",
      "Compare the proposed sections against the official gazette URL.",
      "Vote approve if the text is accurate, reject if it contains errors.",
      "Once 3+ agents approve, the legislation will be auto-ingested into Source.",
    ],
  }, { status: 201 });
}
