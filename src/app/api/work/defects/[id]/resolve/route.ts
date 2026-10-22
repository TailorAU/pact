/**
 * #1160 Round 6.4 — POST /api/work/defects/{id}/resolve
 *
 * Admin-only resolution of an applicability_spotcheck defect. Closes the T6
 * feedback loop from handoff §11.3 — when the curator accepts the agent's
 * finding, the submitter gets their potential_credits paid out on the ledger
 * (reason: `work.applicability_spotcheck.review`). Dismissing a defect marks
 * it closed with a reason for audit but pays nothing.
 *
 * Body:
 *   {
 *     "decision": "accepted" | "dismissed",
 *     "note": "optional free text"
 *   }
 *
 * Semantics:
 *   - Idempotent: resolving an already-resolved defect returns 409.
 *   - Atomic: status flip + wallet credit + ledger entry are batched.
 *   - Never deletes a defect — status transitions only.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { readBodyBounded } from "@/lib/read-body-bounded";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = new Set(["accepted", "dismissed"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "defect id required" }, { status: 400 });
  }

  let body: { decision?: string; note?: string };
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text) as { decision?: string; note?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const decision = (body.decision || "").toLowerCase();
  if (!VALID_DECISIONS.has(decision)) {
    return NextResponse.json(
      { error: `decision must be one of: ${[...VALID_DECISIONS].join(", ")}` },
      { status: 400 },
    );
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
  const resolvedBy =
    req.headers.get("x-admin-actor") || req.headers.get("x-admin-email") || "admin";

  const db = await getDb();
  const lookup = await db.execute({
    sql: `SELECT id, submitted_by, potential_credits, status
            FROM applicability_spotcheck_defects WHERE id = ?`,
    args: [id],
  });
  if (lookup.rows.length === 0) {
    return NextResponse.json({ error: "defect not found" }, { status: 404 });
  }
  const row = lookup.rows[0];
  if (row.status !== "open") {
    return NextResponse.json(
      { error: `defect already ${row.status}` },
      { status: 409 },
    );
  }

  const submitter = String(row.submitted_by);
  const credits = Number(row.potential_credits) || 0;
  const stmts: { sql: string; args: unknown[] }[] = [
    {
      sql: `UPDATE applicability_spotcheck_defects
              SET status = ?, resolved_by = ?, resolved_at = now(),
                  reason = CASE
                    WHEN ? IS NULL THEN reason
                    ELSE reason || E'\n\n[resolution note] ' || ?
                  END
              WHERE id = ?`,
      args: [decision, resolvedBy, note, note, id],
    },
  ];

  let awarded = 0;
  if (decision === "accepted" && credits > 0) {
    awarded = credits;
    stmts.push({
      sql: "INSERT INTO agent_wallets (agent_id, balance) VALUES (?, 0) ON CONFLICT (agent_id) DO NOTHING",
      args: [submitter],
    });
    stmts.push({
      sql: "UPDATE agent_wallets SET balance = balance + ? WHERE agent_id = ?",
      args: [credits, submitter],
    });
    stmts.push({
      sql: "INSERT INTO ledger_txs (id, from_wallet, to_wallet, amount, topic_id, reason) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        randomUUID(),
        "source-protocol",
        submitter,
        credits,
        null,
        "work.applicability_spotcheck.review",
      ],
    });
  }

  await db.batch(stmts);

  return NextResponse.json({
    ok: true,
    defectId: id,
    decision,
    creditsAwarded: awarded,
    submitter,
    resolvedBy,
  });
}
