/**
 * #1152 Round 4 — GET /api/work/assignments
 *
 * Return the calling agent's assignments. Caller must supply
 * `x-source-agent-key`. Optional `?status=open|claimed|submitted|resolved`
 * filters by status; omit for all rows.
 *
 * Response: { assignments: [{ id, workType, payload, rewardCredits, status,
 *             claimedAt, submittedAt, resolvedAt, expiresAt }] }
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveAgentFromKey } from "@/lib/work/auth";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["open", "claimed", "submitted", "resolved"]);

export async function GET(req: Request) {
  const agent = await resolveAgentFromKey(req);
  if (!agent) {
    return NextResponse.json(
      { error: "x-source-agent-key required and must match a registered agent" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  const db = await getDb();
  let sql =
    `SELECT id, work_type, payload, reward_credits, status,
            claimed_at, submitted_at, resolved_at, expires_at, created_at
     FROM agent_work_assignments
     WHERE agent_id = ?`;
  const args: unknown[] = [agent.id];

  if (statusFilter) {
    if (!VALID_STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { error: `status must be one of: ${Array.from(VALID_STATUSES).join(", ")}` },
        { status: 400 },
      );
    }
    sql += " AND status = ?";
    args.push(statusFilter);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";

  const result = await db.execute({ sql, args });

  return NextResponse.json({
    assignments: result.rows.map((r) => ({
      id: r.id,
      workType: r.work_type,
      payload: parseJson(r.payload),
      rewardCredits: r.reward_credits,
      status: r.status,
      claimedAt: r.claimed_at,
      submittedAt: r.submitted_at,
      resolvedAt: r.resolved_at,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
  });
}

function parseJson(v: unknown): unknown {
  if (v == null) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
