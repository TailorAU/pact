/**
 * #1152 Round 3a — POST /api/scenarios/match
 *
 * Input:  { "predicates": { "country_of_operation": "AU", ... } }
 * Output: { "matches": [...], "fallback": null | { model, rationale } }
 *
 * Unauthenticated; free-tier. Round 4 wires optional wallet debit when
 * X-Source-Agent-Key is supplied.
 */
import { NextResponse } from "next/server";
import { listScenarios } from "@/lib/scenarios/queries";
import { matchScenarios } from "@/lib/scenarios/predicate-match";
import { llmMatch } from "@/lib/scenarios/llm-match";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const predicates = (body as { predicates?: unknown }).predicates;
  if (!predicates || typeof predicates !== "object") {
    return NextResponse.json(
      { error: "body.predicates must be an object of predicate key/value pairs" },
      { status: 400 },
    );
  }

  const scenarios = await listScenarios();
  const matches = matchScenarios(
    scenarios.map((s) => ({ id: s.id, title: s.title, predicates: s.predicates })),
    predicates as Record<string, unknown>,
  );

  let fallback: { model: string; rationale: string; scenarioId: string | null } | null = null;
  const topConfidence = matches[0]?.confidence ?? 0;
  if (topConfidence < 0.5 && scenarios.length > 0) {
    const llm = await llmMatch(
      scenarios.map((s) => ({ id: s.id, title: s.title, predicates: s.predicates })),
      predicates as Record<string, unknown>,
    );
    fallback = llm
      ? { model: llm.model, rationale: llm.rationale, scenarioId: llm.scenarioId }
      : null;
  }

  return NextResponse.json({ matches, fallback });
}
