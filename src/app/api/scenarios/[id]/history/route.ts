/**
 * #1160 Round 6.4 — GET /api/scenarios/{id}/history
 *
 * Admin-only. Returns the ordered revision history of a scenario from
 * `scenario_revisions` (handoff §11.5). Includes the trigger code / actor /
 * before+after snapshots / edge deltas for every mutation.
 *
 * Query params:
 *   ?limit=50   (default 50, max 500)  — most recent first
 *
 * The runbook's "how to read `scenario_revisions`" section (§11.8 item 7)
 * points admins at this endpoint + the example query below.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "scenario id required" }, { status: 400 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 50;

  const db = await getDb();

  // Verify scenario exists so we can return 404 distinctly from "no revisions yet".
  const scn = await db.execute({
    sql: `SELECT id, title, deprecated_at, superseded_by
            FROM scenarios WHERE id = ?`,
    args: [id],
  });
  if (scn.rows.length === 0) {
    return NextResponse.json({ error: "scenario not found" }, { status: 404 });
  }
  const head = scn.rows[0];

  const result = await db.execute({
    sql: `SELECT id, revision_kind, trigger_code, trigger_detail,
                 before_state, after_state, edges_delta,
                 changed_by, commit_sha, created_at
            FROM scenario_revisions
           WHERE scenario_id = ?
           ORDER BY created_at DESC
           LIMIT ${limit}`,
    args: [id],
  });

  const revisions = result.rows.map((r) => ({
    id: r.id,
    kind: r.revision_kind,
    triggerCode: r.trigger_code,
    triggerDetail: r.trigger_detail,
    beforeState: coerceJson(r.before_state),
    afterState: coerceJson(r.after_state),
    edgesDelta: coerceJson(r.edges_delta),
    changedBy: r.changed_by,
    commitSha: r.commit_sha,
    createdAt: r.created_at,
  }));

  return NextResponse.json({
    scenarioId: id,
    title: head.title,
    deprecatedAt: head.deprecated_at,
    supersededBy: head.superseded_by,
    revisions,
    count: revisions.length,
  });
}

function coerceJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
