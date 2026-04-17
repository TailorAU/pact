/**
 * #1152 Round 3a — GET /api/scenarios/:id/applicable
 *
 * Returns the applicability subgraph for a scenario:
 *   - the scenario itself
 *   - its applies_when edges (to topics AND legislation)
 *   - its co_applies edges (legislation↔legislation / topic↔topic) scoped to it
 *   - enriched legislation_docs + topics metadata for presentation
 *
 * Unauthenticated; free-tier. Round 4 wires optional wallet debit.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getScenario, getAppliesWhen, getCoApplies,
} from "@/lib/scenarios/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenario = await getScenario(id);
  if (!scenario) {
    return NextResponse.json({ error: "scenario not found" }, { status: 404 });
  }

  const [appliesWhen, coApplies] = await Promise.all([
    getAppliesWhen(id),
    getCoApplies(id),
  ]);

  const topicIds = new Set<string>();
  const legIds = new Set<string>();
  for (const a of appliesWhen) {
    if (a.topicId) topicIds.add(a.topicId);
    if (a.legislationId) legIds.add(a.legislationId);
  }
  for (const c of coApplies) {
    if (c.leftTopicId) topicIds.add(c.leftTopicId);
    if (c.rightTopicId) topicIds.add(c.rightTopicId);
    if (c.leftLegislationId) legIds.add(c.leftLegislationId);
    if (c.rightLegislationId) legIds.add(c.rightLegislationId);
  }

  const db = await getDb();
  const topics: Record<string, unknown>[] = [];
  const legislation: Record<string, unknown>[] = [];

  if (topicIds.size > 0) {
    const r = await db.execute({
      sql: `SELECT id, title, tier, status, jurisdiction, authority
            FROM topics WHERE id = ANY (?::text[])`,
      args: [Array.from(topicIds)],
    });
    topics.push(...r.rows);
  }
  if (legIds.size > 0) {
    const r = await db.execute({
      sql: `SELECT id, jurisdiction, doc_type, title, short_title, year
            FROM legislation_docs WHERE id = ANY (?::text[])`,
      args: [Array.from(legIds)],
    });
    legislation.push(...r.rows);
  }

  return NextResponse.json({
    scenario,
    appliesWhen,
    coApplies,
    topics,
    legislation,
    counts: {
      appliesWhen: appliesWhen.length,
      coApplies: coApplies.length,
      topics: topics.length,
      legislation: legislation.length,
    },
  });
}
