/**
 * #1160 Round 6.4 — GET /api/scenarios/coverage-gaps
 *
 * Admin-only. Surfaces predicate sets that the matcher frequently fails to
 * resolve — the T7 detection channel from handoff §11.3. Reads from
 * `match_request_log` (written by POST /api/scenarios/match) and groups by
 * the normalised predicate signature.
 *
 * Query params:
 *   ?windowDays=30    Look-back window (default 30, max 365)
 *   ?minCount=5       Minimum occurrences to surface a signature (default 5)
 *   ?limit=50         Top-N signatures (default 50, max 500)
 *
 * A "gap" is defined as: a predicate signature seen ≥ minCount times in the
 * window whose *best* live scenario match-confidence would be below 0.5.
 * We compute match-confidence in JS rather than SQL so we can reuse the
 * same matcher the production endpoint uses — keeping "gap" and "weak match"
 * definitionally identical.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { listScenarios } from "@/lib/scenarios/queries";
import { matchScenarios } from "@/lib/scenarios/predicate-match";

export const dynamic = "force-dynamic";

const WEAK_CONFIDENCE = 0.5;

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const windowDays = clamp(
    parseInt(url.searchParams.get("windowDays") || "30", 10),
    1,
    365,
    30,
  );
  const minCount = clamp(
    parseInt(url.searchParams.get("minCount") || "5", 10),
    1,
    10_000,
    5,
  );
  const limit = clamp(
    parseInt(url.searchParams.get("limit") || "50", 10),
    1,
    500,
    50,
  );

  const db = await getDb();
  const logs = await db.execute({
    sql: `SELECT predicates, created_at
            FROM match_request_log
           WHERE created_at >= now() - make_interval(days => ?)`,
    args: [windowDays],
  });

  const buckets = new Map<
    string,
    { predicates: Record<string, unknown>; count: number; lastSeen: string }
  >();
  for (const r of logs.rows) {
    const preds = coercePredicates(r.predicates);
    if (!preds) continue;
    const key = normaliseKey(preds);
    const bucket = buckets.get(key);
    const lastSeen = typeof r.created_at === "string" ? r.created_at : String(r.created_at ?? "");
    if (bucket) {
      bucket.count += 1;
      if (lastSeen > bucket.lastSeen) bucket.lastSeen = lastSeen;
    } else {
      buckets.set(key, { predicates: preds, count: 1, lastSeen });
    }
  }

  // Filter by minCount before we spend cycles running the matcher.
  const candidates = [...buckets.values()].filter((b) => b.count >= minCount);

  // Live scenarios only — gaps are against the graph we'd actually ship to.
  const scenarios = (await listScenarios()).map((s) => ({
    id: s.id,
    title: s.title,
    predicates: s.predicates,
  }));

  const gaps = candidates
    .map((b) => {
      const matches = matchScenarios(scenarios, b.predicates);
      const top = matches[0];
      return {
        predicates: b.predicates,
        count: b.count,
        lastSeen: b.lastSeen,
        topMatch: top
          ? {
              scenarioId: top.scenarioId,
              confidence: top.confidence,
            }
          : null,
      };
    })
    .filter((g) => !g.topMatch || g.topMatch.confidence < WEAK_CONFIDENCE)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return NextResponse.json({
    gaps,
    window: { days: windowDays, sampleSize: logs.rows.length },
    weakConfidenceThreshold: WEAK_CONFIDENCE,
    filter: { minCount, limit },
  });
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, min), max);
}

function coercePredicates(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

/** Canonical signature — sorted keys, JSON-serialised values. */
function normaliseKey(preds: Record<string, unknown>): string {
  const keys = Object.keys(preds).sort();
  return JSON.stringify(keys.map((k) => [k, preds[k]]));
}
