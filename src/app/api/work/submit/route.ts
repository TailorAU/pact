/**
 * #1152 Round 4 — POST /api/work/submit
 *
 * Submit a completed work assignment. Validates via lib/work/validators, then
 * atomically:
 *   1. updates `agent_work_assignments` status to `resolved` and sets
 *      `submitted_at` / `resolved_at`,
 *   2. inserts a row into `agent_work_ledger` with accepted/credits_awarded,
 *   3. if accepted and NOT deferred, credits the agent's wallet and logs a
 *      `ledger_txs` row (reason `work.{workType}`).
 *
 * Caller must supply `x-source-agent-key`. Body shape:
 *   { "assignmentId": string, "submission": { ... } }
 *
 * Response (200): { accepted, deferred, creditsAwarded, ledgerId, notes }
 * Response (404): assignment not found / not owned by caller
 * Response (409): assignment already resolved
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { resolveAgentFromKey } from "@/lib/work/auth";
import { validate } from "@/lib/work/validators";
import { readBodyBounded } from "@/lib/read-body-bounded";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const agent = await resolveAgentFromKey(req);
  if (!agent) {
    return NextResponse.json(
      { error: "x-source-agent-key required and must match a registered agent" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : "";
  const submission =
    body.submission && typeof body.submission === "object"
      ? (body.submission as Record<string, unknown>)
      : null;

  if (!assignmentId || !submission) {
    return NextResponse.json(
      { error: "assignmentId (string) and submission (object) are required" },
      { status: 400 },
    );
  }

  const db = await getDb();

  const lookup = await db.execute({
    sql: `SELECT id, work_type, status, reward_credits
          FROM agent_work_assignments
          WHERE id = ? AND agent_id = ?`,
    args: [assignmentId, agent.id],
  });
  if (lookup.rows.length === 0) {
    return NextResponse.json(
      { error: "assignment not found or not owned by agent" },
      { status: 404 },
    );
  }
  const row = lookup.rows[0];
  if (row.status === "resolved") {
    return NextResponse.json(
      { error: "assignment already resolved" },
      { status: 409 },
    );
  }

  const workType = row.work_type as string;
  // #1160 Round 3 — validators now run async so `applicability_spotcheck`
  // can consult `scenarios` / `scenario_applies_when` / `topics` /
  // `legislation_docs` before accepting a submission.
  const validation = await validate(workType, submission, { db });

  const ledgerId = randomUUID();
  const stmts: { sql: string; args: unknown[] }[] = [
    {
      sql: `UPDATE agent_work_assignments
            SET status = 'resolved', submitted_at = now(), resolved_at = now()
            WHERE id = ?`,
      args: [assignmentId],
    },
    {
      sql: `INSERT INTO agent_work_ledger
              (id, agent_id, assignment_id, submission, validator_notes, accepted, credits_awarded)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        ledgerId,
        agent.id,
        assignmentId,
        JSON.stringify(submission),
        validation.notes,
        validation.accept,
        validation.accept && !validation.defer ? validation.credits : 0,
      ],
    },
  ];

  if (validation.accept && !validation.defer && validation.credits > 0) {
    stmts.push({
      sql: "INSERT INTO agent_wallets (agent_id, balance) VALUES (?, 0) ON CONFLICT (agent_id) DO NOTHING",
      args: [agent.id],
    });
    stmts.push({
      sql: "UPDATE agent_wallets SET balance = balance + ? WHERE agent_id = ?",
      args: [validation.credits, agent.id],
    });
    stmts.push({
      sql: "INSERT INTO ledger_txs (id, from_wallet, to_wallet, amount, topic_id, reason) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        randomUUID(),
        "source-protocol",
        agent.id,
        validation.credits,
        null,
        `work.${workType}`,
      ],
    });
  }

  // #1160 Round 3 — review_existing defects are persisted in the same batch so
  // the ledger + defects rows stay consistent. Even deferred (credits held)
  // submissions capture the finding for curator review.
  const defectIds: string[] = [];
  if (
    workType === "applicability_spotcheck" &&
    validation.accept &&
    validation.defects &&
    validation.defects.length > 0
  ) {
    const scenarioId =
      typeof submission.scenarioId === "string" ? submission.scenarioId : null;
    if (scenarioId) {
      for (const d of validation.defects) {
        const defectId = randomUUID();
        defectIds.push(defectId);
        stmts.push({
          sql: `INSERT INTO applicability_spotcheck_defects
                  (id, scenario_id, submitted_by, assignment_id,
                   finding_kind, edge_id, target_kind, target_id, reason,
                   status, potential_credits)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
          args: [
            defectId,
            scenarioId,
            agent.id,
            assignmentId,
            d.findingKind,
            d.edgeId,
            d.targetKind,
            d.targetId,
            d.reason,
            d.potentialCredits,
          ],
        });
      }
    }
  }

  // #1216 — price_observation_mining post-validation hook
  // (a) Find-or-create the market.products row
  // (b) Find-or-create the market.item_key_product_links row (first-agent-wins canonical)
  // (c) Insert market.price_observations row
  // (d) Insert market.price_observation_defects row if validator flagged one
  // Reads run before the batch since market.products id is generated server-side
  // and we need it for downstream FKs.
  let priceObservationId: string | null = null;
  let priceDefectId: string | null = null;
  if (workType === "price_observation_mining") {
    const obs = validation.priceObservation;
    const defect = validation.priceDefect;

    if (obs) {
      // Find-or-create product. Prefer EAN match; fall back to (name, retailer) URL exact match.
      let productId: string | null = null;
      if (obs.productEan) {
        const found = await db.execute({
          sql: "SELECT id FROM market.products WHERE ean = ? LIMIT 1",
          args: [obs.productEan],
        });
        if (found.rows.length > 0) productId = String(found.rows[0].id);
      }
      if (!productId) {
        // Match by exact product_url across observations of the same retailer
        // (URL is the strongest natural key when EAN is absent).
        const found = await db.execute({
          sql: `SELECT po.product_id
                FROM market.price_observations po
                WHERE po.retailer_id = ? AND po.product_url = ?
                ORDER BY po.observed_at DESC
                LIMIT 1`,
          args: [obs.retailerId, obs.productUrl],
        });
        if (found.rows.length > 0) productId = String(found.rows[0].product_id);
      }
      if (!productId) {
        productId = randomUUID();
        stmts.push({
          sql: `INSERT INTO market.products (id, name, ean, category)
                VALUES (?, ?, ?, 'hardware-quote-rates')`,
          args: [productId, obs.productName, obs.productEan],
        });
      }

      // Find-or-create canonical item_key_product_links row.
      const linkExists = await db.execute({
        sql: `SELECT 1 AS one FROM market.item_key_product_links
              WHERE item_key = ? AND retailer_id = ? AND product_id = ?
              AND deprecated_at IS NULL
              LIMIT 1`,
        args: [obs.itemKey, obs.retailerId, productId],
      });
      if (linkExists.rows.length === 0) {
        stmts.push({
          sql: `INSERT INTO market.item_key_product_links
                  (item_key, retailer_id, product_id, tier, is_canonical, curator_notes)
                VALUES (?, ?, ?, 'standard', true,
                        'first-agent-wins via price_observation_mining; curator may swap')
                ON CONFLICT (item_key, retailer_id, product_id, tier) DO NOTHING`,
          args: [obs.itemKey, obs.retailerId, productId],
        });
      }

      // Insert observation
      priceObservationId = randomUUID();
      stmts.push({
        sql: `INSERT INTO market.price_observations
                (id, product_id, retailer_id, price_cents, unit_price_cents,
                 unit_price_unit, in_stock, product_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          priceObservationId,
          productId,
          obs.retailerId,
          obs.priceCents,
          obs.unitPriceCents,
          obs.unitPriceUnit,
          obs.inStock,
          obs.productUrl,
        ],
      });
    }

    if (defect) {
      priceDefectId = randomUUID();
      stmts.push({
        sql: `INSERT INTO market.price_observation_defects
                (id, item_key, retailer_id, submitted_by, assignment_id,
                 finding_kind, submitted_price_cents, submitted_unit, product_url,
                 reason, status, potential_credits)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        args: [
          priceDefectId,
          defect.itemKey,
          defect.retailerId,
          agent.id,
          assignmentId,
          defect.findingKind,
          defect.submittedPriceCents,
          defect.submittedUnit,
          defect.productUrl,
          defect.reason,
          defect.potentialCredits,
        ],
      });
    }
  }

  await db.batch(stmts);

  return NextResponse.json({
    accepted: validation.accept,
    deferred: validation.defer,
    creditsAwarded: validation.accept && !validation.defer ? validation.credits : 0,
    ledgerId,
    notes: validation.notes,
    defectIds: defectIds.length > 0 ? defectIds : undefined,
    priceObservationId: priceObservationId ?? undefined,
    priceDefectId: priceDefectId ?? undefined,
  });
}
