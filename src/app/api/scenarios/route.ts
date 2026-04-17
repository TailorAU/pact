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

export const dynamic = "force-dynamic";

export async function GET() {
  const scenarios = await listScenarios();
  return NextResponse.json({ scenarios });
}

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "admin secret not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== adminSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
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
  await db.execute({
    sql: `INSERT INTO scenarios (id, title, description, industry, predicates, tags)
          VALUES (?, ?, ?, ?, ?::jsonb, ?)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            industry = EXCLUDED.industry,
            predicates = EXCLUDED.predicates,
            tags = EXCLUDED.tags,
            updated_at = now()`,
    args: [id, title, description, industry, JSON.stringify(predicates), tags],
  });
  return NextResponse.json({ id, status: "upserted" }, { status: 200 });
}
