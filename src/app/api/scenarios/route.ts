/**
 * #1152 Round 3a — Scenario collection endpoint.
 *
 * GET /api/scenarios            — list all scenarios.
 * POST /api/scenarios           — idempotent upsert (for seed scripts).
 *
 * Seed scripts can equally write directly to Postgres (see
 * sites/source/scripts/seed_scenarios_*.py); this endpoint exists so
 * third-party tooling can create scenarios via HTTP without DB access.
 * Auth: requires ADMIN_SECRET in `Authorization: Bearer <secret>`.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listScenarios } from "@/lib/scenarios/queries";
import { recordAudit } from "@/lib/audit";
import { safeSecretEqual } from "@/lib/secret-compare";
import { readBodyBounded, ADMIN_INGEST_MAX_BODY_BYTES } from "@/lib/read-body-bounded";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // #1160 Round 6.2 — honour ?includeDeprecated=true for audit/migration tooling.
  const url = new URL(req.url);
  const includeDeprecated = url.searchParams.get("includeDeprecated") === "true";
  const scenarios = await listScenarios({ includeDeprecated });
  return NextResponse.json({ scenarios });
}

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "admin secret not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !safeSecretEqual(auth.slice(7), adminSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  const bounded = await readBodyBounded(req, ADMIN_INGEST_MAX_BODY_BYTES);
  if (!bounded.ok) return bounded.response;
  try { body = JSON.parse(bounded.text); } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id : null;
  const title = typeof input.title === "string" ? input.title : null;
  const description = typeof input.description === "string" ? input.description : null;
  const industry = typeof input.industry === "string" ? input.industry : null;
  const sourceRef =
    typeof input.sourceRef === "string" ? input.sourceRef :
    typeof input.source_ref === "string" ? input.source_ref : null;
  const jurisdiction = typeof input.jurisdiction === "string" ? input.jurisdiction : null;
  const predicates = input.predicates && typeof input.predicates === "object"
    ? input.predicates as Record<string, unknown>
    : null;
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  if (!id || !title || !description || !predicates) {
    return NextResponse.json(
      { error: "id, title, description, predicates are required" },
      { status: 400 },
    );
  }

  const db = await getDb();
  // Read pre-state for audit before/after diff
  const prior = await db.execute({
    sql: `SELECT id, title, description FROM scenarios WHERE id = ?`,
    args: [id],
  });
  const beforeSnapshot = prior.rows[0] ?? null;

  await db.execute({
    sql: `INSERT INTO scenarios (id, title, description, industry, predicates, tags, source_ref, jurisdiction)
          VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            industry = EXCLUDED.industry,
            predicates = EXCLUDED.predicates,
            tags = EXCLUDED.tags,
            source_ref = COALESCE(EXCLUDED.source_ref, scenarios.source_ref),
            jurisdiction = COALESCE(EXCLUDED.jurisdiction, scenarios.jurisdiction),
            updated_at = now()`,
    args: [id, title, description, industry, JSON.stringify(predicates), tags, sourceRef, jurisdiction],
  });

  // Audit log — WS2 mutation backfill
  // actorKey is null here: admin endpoints use a shared secret, not a per-agent key.
  await recordAudit({
    actorKey: null,
    actorLabel: "admin",
    op: "scenarios.scenario.create",
    entityType: "scenario",
    entityId: id,
    before: beforeSnapshot ?? null,
    after: { id, title, description, industry, jurisdiction, tagCount: tags.length },
    requestId: req.headers.get("x-request-id"),
  });

  return NextResponse.json({ id, status: "upserted" }, { status: 200 });
}
