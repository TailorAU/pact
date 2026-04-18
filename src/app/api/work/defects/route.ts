/**
 * #1160 Round 6.4 — GET /api/work/defects
 *
 * Admin-only list of applicability_spotcheck defects. Supports the filters
 * needed by the Chief-of-Source triage workflow:
 *   - ?status=open|accepted|dismissed   (default: "open")
 *   - ?scenario=scn.xxx                 (exact scenario id)
 *   - ?cluster=mining-safety            (industry label — matches scenarios.industry)
 *   - ?submittedBy=agt.xxx              (agent id)
 *   - ?limit=50                         (default 50, max 500)
 *
 * Rationale: the defects table is the canonical T6 detection surface
 * (handoff §11.3). Without a list endpoint, the SLA in §11.4 ("resolved
 * within 7 days") cannot be measured or acted on.
 *
 * Response shape is deliberately flat so the operator can pipe it straight
 * into the resolve endpoint without reshaping.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set(["open", "accepted", "dismissed", "all"]);

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "open").toLowerCase();
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json(
      { error: `status must be one of ${[...ALLOWED_STATUS].join(", ")}` },
      { status: 400 },
    );
  }
  const scenario = url.searchParams.get("scenario");
  const cluster = url.searchParams.get("cluster");
  const submittedBy = url.searchParams.get("submittedBy");
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 50;

  // Build dynamic WHERE clauses. We avoid string concatenation for values —
  // every placeholder goes through parameter binding.
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (status !== "all") {
    clauses.push("d.status = ?");
    args.push(status);
  }
  if (scenario) {
    clauses.push("d.scenario_id = ?");
    args.push(scenario);
  }
  if (cluster) {
    clauses.push("s.industry = ?");
    args.push(cluster);
  }
  if (submittedBy) {
    clauses.push("d.submitted_by = ?");
    args.push(submittedBy);
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT d.id, d.scenario_id, s.title AS scenario_title, s.industry AS cluster,
                 d.submitted_by, d.assignment_id, d.finding_kind, d.edge_id,
                 d.target_kind, d.target_id, d.reason, d.status,
                 d.resolved_by, d.resolved_at, d.potential_credits, d.created_at
            FROM applicability_spotcheck_defects d
            JOIN scenarios s ON s.id = d.scenario_id
            ${where}
           ORDER BY d.created_at DESC
           LIMIT ${limit}`,
    args,
  });

  const defects = result.rows.map((r) => ({
    id: r.id,
    scenarioId: r.scenario_id,
    scenarioTitle: r.scenario_title,
    cluster: r.cluster,
    submittedBy: r.submitted_by,
    assignmentId: r.assignment_id,
    findingKind: r.finding_kind,
    edgeId: r.edge_id,
    targetKind: r.target_kind,
    targetId: r.target_id,
    reason: r.reason,
    status: r.status,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    potentialCredits: r.potential_credits,
    createdAt: r.created_at,
  }));

  return NextResponse.json({
    defects,
    count: defects.length,
    filter: { status, scenario, cluster, submittedBy, limit },
  });
}
