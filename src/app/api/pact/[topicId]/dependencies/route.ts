import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction, wouldCreateCycle, VALID_RELATIONSHIPS, requiredReopenVotes } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { readBodyBounded } from "@/lib/read-body-bounded";
import { warrantKindFromTier, consensusStateFor, credenceFromRatio, DEFEATER_TYPES } from "@/lib/epistemic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  const deps = await db.execute({
    sql: `SELECT td.depends_on, td.relationship, td.justification, t.title, t.status, t.tier,
        t.convention_stop, t.credence, t.consensus_ratio
      FROM topic_dependencies td
      JOIN topics t ON t.id = td.depends_on
      WHERE td.topic_id = ?`,
    args: [topicId],
  });

  const dependents = await db.execute({
    sql: `SELECT td.topic_id, td.relationship, td.justification, t.title, t.status, t.tier,
        t.convention_stop, t.credence, t.consensus_ratio
      FROM topic_dependencies td
      JOIN topics t ON t.id = td.topic_id
      WHERE td.depends_on = ?`,
    args: [topicId],
  });

  const enrich = (r: Record<string, unknown>) => ({
    ...r,
    warrantKind: warrantKindFromTier(r.tier as string),
    conventionStop: !!r.convention_stop,
    state: consensusStateFor(r.status as string),
    credence: (r.credence as number | null) ?? credenceFromRatio(r.consensus_ratio as number | null),
  });

  // Split by relationship type
  const assumptions = deps.rows.filter((r) => r.relationship === "assumes").map(enrich);
  const buildsOn = deps.rows.filter((r) => r.relationship !== "assumes").map(enrich);
  const assumedBy = dependents.rows.filter((r) => r.relationship === "assumes").map(enrich);
  const usedBy = dependents.rows.filter((r) => r.relationship !== "assumes").map(enrich);

  // ── Consensus frontier (#3691 W4) ─────────────────────────────────
  // A drill never bottoms out at bedrock. A node with no outgoing
  // dependencies is a FRONTIER: the place the community currently agrees
  // to stop digging — annotated with who agreed, when, on what warrant,
  // and a live reopen path. Epistemically identical to every other node.
  let frontier: Record<string, unknown> | null = null;
  const anchorResult = await db.execute({
    sql: `SELECT t.id, t.title, t.status, t.tier, t.convention_stop, t.credence,
        t.consensus_ratio, t.consensus_since, t.consensus_voters,
        (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'challenge') as standingChallenges
      FROM topics t WHERE t.id = ?`,
    args: [topicId],
  });
  const anchor = anchorResult.rows[0];
  if (anchor) {
    const isFrontier = deps.rows.length === 0;
    const alignedAgents = await db.execute({
      sql: `SELECT a.name FROM registrations r JOIN agents a ON a.id = r.agent_id
        WHERE r.topic_id = ? AND r.done_status = 'aligned' ORDER BY r.done_at ASC LIMIT 25`,
      args: [topicId],
    });
    frontier = {
      isFrontier,
      // #5564 — the source column alongside the collapsed warrantKind: the
      // extension's tier vocabulary is 8-valued and the warrant collapse is
      // lossy, so a conformant consumer needs the stored tier itself. Every
      // other topic surface already serves it via row spread; the frontier
      // block was the one hand-built shape that dropped it.
      tier: anchor.tier,
      warrantKind: warrantKindFromTier(anchor.tier as string),
      conventionStop: !!anchor.convention_stop,
      state: consensusStateFor(anchor.status as string),
      credence: (anchor.credence as number | null) ?? credenceFromRatio(anchor.consensus_ratio as number | null),
      heldBy: alignedAgents.rows.map((r) => r.name),
      consensusVoters: anchor.consensus_voters,
      consensusSince: anchor.consensus_since,
      standingChallenges: anchor.standingChallenges,
      reopen: {
        path: `POST /api/pact/${topicId}/proposals`,
        proposalType: "challenge",
        defeaterTypes: DEFEATER_TYPES,
        requiredSupportVotes: requiredReopenVotes(dependents.rows.length),
      },
      ...(isFrontier
        ? {
            note:
              "Consensus frontier: this chain terminates here not because bedrock was reached, but because this is where the community currently agrees to stop. Held by convention · challengeable — like every other node.",
          }
        : {}),
    };
  }

  return NextResponse.json({
    assumptions,
    buildsOn,
    assumedBy,
    usedBy,
    frontier,
  });
}

// ── First-principles dependency assessment ──────────────────────────
// Agents must answer these questions to justify a dependency link.
// This prevents weak "related to" links that pollute the knowledge graph.

const ASSESSMENT_QUESTIONS = {
  assumes: {
    necessity: "If the dependency topic were proven false, would this topic's claim become logically invalid or meaningless?",
    direction: "Is this a logical prerequisite (not just related context)?",
  },
  builds_on: {
    necessity: "Does this topic directly extend, specialise, or narrow the scope of the dependency topic?",
    direction: "Could this topic exist as a standalone fact without the dependency, or does it structurally require the dependency to have meaning?",
  },
} as const;

// ── Validation rules ────────────────────────────────────────────────
// These catch the common bad-link patterns we've seen.

function validateJustification(
  rel: string,
  justification: { necessity: string; direction: string }
): { valid: boolean; error?: string } {
  const n = justification.necessity?.trim() ?? "";
  const d = justification.direction?.trim() ?? "";

  // Must actually answer both questions
  if (n.length < 20) {
    return {
      valid: false,
      error: `"necessity" answer is too short (${n.length} chars). Explain in at least 20 characters why this dependency is required, not just related.`,
    };
  }
  if (d.length < 20) {
    return {
      valid: false,
      error: `"direction" answer is too short (${d.length} chars). Explain in at least 20 characters why this is a parent→child relationship, not a sibling/peer relationship.`,
    };
  }

  // Detect lazy/generic answers
  const lazyPatterns = [
    /both (are|deal with|relate|involve|concern)/i,
    /they are (related|similar|connected|in the same)/i,
    /same (domain|area|field|topic|category)/i,
    /related to/i,
    /associated with/i,
  ];

  for (const pattern of lazyPatterns) {
    if (pattern.test(n) || pattern.test(d)) {
      return {
        valid: false,
        error: `Justification uses "related to" language. Dependencies must be structural (A requires B to be true/meaningful), not associative (A and B are in the same area). Rethink: would removing B make A logically incomplete or invalid?`,
      };
    }
  }

  // For "assumes": the necessity answer should indicate logical dependency
  if (rel === "assumes") {
    const logicalTerms = /\b(false|invalid|undefined|meaningless|cannot|impossible|contradicts|requires|presupposes|necessary|prerequisite|axiom|foundational)\b/i;
    if (!logicalTerms.test(n)) {
      return {
        valid: false,
        error: `For "assumes" relationships, the necessity answer must explain the logical dependency — what breaks if the dependency is false? Use terms like "invalid", "meaningless", "cannot", "requires", "presupposes".`,
      };
    }
  }

  // For "builds_on": the direction answer should indicate specialisation
  if (rel === "builds_on") {
    const structuralTerms = /\b(extends|specialises|specializes|narrows|implements|derives|supersedes|amends|incorporates|mandated by|established by|created under|section|part|division|subordinate|enabling)\b/i;
    if (!structuralTerms.test(d)) {
      return {
        valid: false,
        error: `For "builds_on" relationships, the direction answer must explain the structural hierarchy — how does this topic extend/specialise/derive from the dependency? Use terms like "extends", "specialises", "narrows", "implements", "derives from", "created under".`,
      };
    }
  }

  return { valid: true };
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

  let body;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dependsOn, relationship, justification } = body;
  if (!dependsOn) {
    return NextResponse.json({ error: "dependsOn (topic ID) is required" }, { status: 400 });
  }

  // Validate relationship type
  const rel = relationship ?? "builds_on";
  if (!VALID_RELATIONSHIPS.includes(rel as typeof VALID_RELATIONSHIPS[number])) {
    return NextResponse.json(
      { error: `Invalid relationship type. Must be one of: ${VALID_RELATIONSHIPS.join(", ")}` },
      { status: 400 }
    );
  }

  // ── First-principles assessment gate ──────────────────────────────
  // Agent must provide structured justification answering the assessment questions.
  if (!justification || typeof justification !== "object") {
    const questions = ASSESSMENT_QUESTIONS[rel as keyof typeof ASSESSMENT_QUESTIONS] ?? ASSESSMENT_QUESTIONS.builds_on;
    return NextResponse.json({
      error: "Dependency requires first-principles justification",
      assessment: {
        relationship: rel,
        questions,
        required_format: {
          justification: {
            necessity: "<your answer to the necessity question>",
            direction: "<your answer to the direction question>",
          },
        },
        guidance: rel === "assumes"
          ? "An 'assumes' link means B is a logical prerequisite of A. If B were false, A would be invalid or meaningless. Example: Modus ponens assumes the law of non-contradiction — if contradictions were allowed, modus ponens would be vacuous."
          : "A 'builds_on' link means A extends, specialises, or structurally derives from B. A narrows B's scope or adds specificity. Example: CMSHA (Qld) builds_on WHS Act (Cth) — the CMSHA is subordinate state legislation created under the enabling framework of the federal WHS Act.",
        anti_patterns: [
          "Topics that are merely 'related' or 'in the same area' are NOT dependencies",
          "Siblings (e.g., Fair Work Act and WHS Act are both Cth workplace laws) are NOT parent-child",
          "Sharing a keyword or domain does NOT create a structural dependency",
        ],
      },
    }, { status: 422 });
  }

  // Validate the justification quality
  const validation = validateJustification(rel, justification);
  if (!validation.valid) {
    return NextResponse.json({
      error: "Justification failed first-principles assessment",
      detail: validation.error,
      hint: "A dependency must be structural (A requires B), not associative (A and B are related). Ask yourself: if I deleted B from the knowledge graph entirely, would A become logically incomplete or invalid?",
    }, { status: 422 });
  }

  const db = await getDb();

  // Verify both topics exist
  const topic = await db.execute({ sql: "SELECT id, title FROM topics WHERE id = ?", args: [topicId] });
  if (!topic.rows[0]) return NextResponse.json({ error: "Topic not found" }, { status: 404 });

  const dep = await db.execute({ sql: "SELECT id, title, status FROM topics WHERE id = ?", args: [dependsOn] });
  if (!dep.rows[0]) return NextResponse.json({ error: "Dependency topic not found" }, { status: 404 });

  // The dependency should ideally be a consensus truth
  const depStatus = dep.rows[0].status as string;
  const warning = !["consensus", "stable", "locked"].includes(depStatus)
    ? "Warning: The dependency topic has not yet achieved consensus. This chain is only as strong as its weakest link."
    : undefined;

  // Prevent circular dependencies (BFS traversal)
  if (await wouldCreateCycle(db, topicId, dependsOn)) {
    return NextResponse.json({ error: "Adding this dependency would create a circular chain" }, { status: 400 });
  }

  // Store the full justification as JSON
  const justificationText = JSON.stringify(justification);

  // #5599 PR-A — mutating region in ONE transaction: the edge and its §6.4
  // chain link commit together or not at all. The duplicate-edge race was a
  // swallowed-error try/catch around a plain INSERT — fatal inside a
  // transaction (25P02 on every later statement) — so it is rewritten as
  // ON CONFLICT DO NOTHING with a rowsAffected probe.
  const outcome = await withTransaction(db, async (tx) => {
    const inserted = await tx.execute({
      sql: "INSERT INTO topic_dependencies (topic_id, depends_on, relationship, justification) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      args: [topicId, dependsOn, rel, justificationText],
    });
    if (inserted.rowsAffected === 0) {
      return "duplicate" as const;
    }

    await emitEvent(tx, topicId, "pact.dependency.declared", agent.id, "", {
      dependsOn,
      relationship: rel,
      justification,
      topicTitle: topic.rows[0].title,
      dependsOnTitle: dep.rows[0].title,
    });
    return "declared" as const;
  });

  if (outcome === "duplicate") {
    return NextResponse.json({ error: "Dependency already exists" }, { status: 409 });
  }

  return NextResponse.json({
    topicId,
    dependsOn,
    relationship: rel,
    justification,
    ...(warning ? { warning } : {}),
  }, { status: 201 });
}

// ── DELETE: Remove a bad dependency ──────────────────────────────────
export async function DELETE(
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

  let body;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dependsOn, reason } = body;
  if (!dependsOn) {
    return NextResponse.json({ error: "dependsOn (topic ID) is required" }, { status: 400 });
  }
  if (!reason || reason.trim().length < 10) {
    return NextResponse.json({ error: "reason is required (min 10 chars) explaining why this dependency is invalid" }, { status: 400 });
  }

  const db = await getDb();

  // Verify the dependency exists
  const existing = await db.execute({
    sql: "SELECT * FROM topic_dependencies WHERE topic_id = ? AND depends_on = ?",
    args: [topicId, dependsOn],
  });
  if (!existing.rows[0]) {
    return NextResponse.json({ error: "Dependency not found" }, { status: 404 });
  }

  // #5599 PR-A — mutating region in ONE transaction: the edge removal and
  // its §6.4 chain link commit together or not at all.
  await withTransaction(db, async (tx) => {
    await tx.execute({
      sql: "DELETE FROM topic_dependencies WHERE topic_id = ? AND depends_on = ?",
      args: [topicId, dependsOn],
    });

    await emitEvent(tx, topicId, "pact.dependency.removed", agent.id, "", {
      dependsOn,
      reason,
      removedRelationship: existing.rows[0].relationship,
    });
  });

  return NextResponse.json({
    removed: true,
    topicId,
    dependsOn,
    reason,
  });
}
