/**
 * #1152 Round 3a — POST /api/scenarios/match
 *
 * Input:  { "predicates": { "country_of_operation": "AU", ... } }
 * Output: { "matches": [...], "fallback": null | { model, rationale } }
 *
 * Unauthenticated reads remain free. When an agent supplies an
 * `x-source-agent-key`, we debit 1 credit per call (reason `read.scenario`).
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { listScenarios } from "@/lib/scenarios/queries";
import { matchScenarios } from "@/lib/scenarios/predicate-match";
import { llmMatch } from "@/lib/scenarios/llm-match";
import { debitIfAuthenticated } from "@/lib/wallet-debit";
import { resolveAgentFromKey } from "@/lib/work/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const debit = await debitIfAuthenticated(req, 1, "read.scenario");
  if (!debit.ok) {
    return NextResponse.json(debit.body, { status: debit.status });
  }

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

  // #1160 Round 6.2 — matcher sees ALL scenarios (including deprecated) so
  // callers relying on a deprecated id still get a signal. We cap deprecated
  // match confidence at 0.3 and decorate the result with `deprecation` /
  // `migrationHint` so consumers can migrate.
  const scenarios = await listScenarios({ includeDeprecated: true });
  const rawMatches = matchScenarios(
    scenarios.map((s) => ({ id: s.id, title: s.title, predicates: s.predicates })),
    predicates as Record<string, unknown>,
  );

  const DEPRECATED_CONFIDENCE_CAP = 0.3;
  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  const matches = rawMatches.map((m) => {
    const s = scenarioById.get(m.scenarioId);
    const deprecated = !!s?.deprecatedAt;
    const successor = s?.supersededBy ? scenarioById.get(s.supersededBy) : null;
    return {
      ...m,
      confidence: deprecated
        ? Math.min(m.confidence, DEPRECATED_CONFIDENCE_CAP)
        : m.confidence,
      scenario: s
        ? {
            id: s.id,
            title: s.title,
            sourceRef: s.sourceRef,
            jurisdiction: s.jurisdiction,
            industry: s.industry,
          }
        : null,
      deprecation: deprecated
        ? {
            since: s?.deprecatedAt ?? null,
            supersededBy: s?.supersededBy ?? null,
          }
        : null,
      migrationHint: successor
        ? {
            successorId: successor.id,
            successorTitle: successor.title,
            reason: "This scenario has been superseded — match against the successor instead.",
          }
        : null,
    };
  });
  // Re-sort after capping so deprecated rows fall behind live rows with
  // equal raw confidence.
  matches.sort((a, b) => b.confidence - a.confidence);

  let fallback: { model: string; rationale: string; scenarioId: string | null } | null = null;
  const topConfidence = matches[0]?.confidence ?? 0;
  if (topConfidence < 0.5 && scenarios.length > 0) {
    // Fallback only considers live (non-deprecated) scenarios so we don't
    // accidentally nudge callers back onto an archived rule set.
    const liveScenarios = scenarios.filter((s) => !s.deprecatedAt);
    const llm = await llmMatch(
      liveScenarios.map((s) => ({ id: s.id, title: s.title, predicates: s.predicates })),
      predicates as Record<string, unknown>,
    );
    fallback = llm
      ? { model: llm.model, rationale: llm.rationale, scenarioId: llm.scenarioId }
      : null;
  }

  // #1160 Round 3 — log every predicate query to seed coverage-gap detection.
  // Stateless best-effort: if the write fails (e.g. table not yet applied),
  // we still return the match result to the caller.
  try {
    const agent = await resolveAgentFromKey(req);
    const db = await getDb();
    await db.execute({
      sql: `INSERT INTO match_request_log (id, predicates, agent_id) VALUES (?, ?, ?)`,
      args: [
        randomUUID(),
        JSON.stringify(predicates),
        agent?.id ?? null,
      ],
    });
  } catch {
    /* swallow — logging is advisory */
  }

  return NextResponse.json({ matches, fallback });
}
