/**
 * GET /api/cron/quote-rates-assignments  (#1216)
 *
 * Daily cron — opens 1 fresh `agent_work_assignment` per stale
 * (item_key, retailer) pair so agents can claim and mine retail prices.
 *
 * "Stale" means either:
 *   - no observation has ever been linked for the (item_key, retailer) pair, OR
 *   - the most recent observation is older than `STALE_THRESHOLD_HOURS`.
 *
 * Each assignment carries the standard `WORK_REWARDS.price_observation_mining`
 * (2 credits) and a payload with `{ itemKey, retailerSlug, expectedUnit }`
 * so the claiming agent doesn't need a second round-trip.
 *
 * Caps: at most `MAX_PER_RUN` assignments opened per cron run, to avoid
 * flooding the queue if many pairs go stale at once.
 *
 * Auth: Bearer ${CRON_SECRET} in Authorization header (same pattern as
 * cron/staleness, cron/auto-merge).
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { WORK_REWARDS } from "@/lib/work/validators";

export const dynamic = "force-dynamic";

const STALE_THRESHOLD_HOURS = 24;
const ASSIGNMENT_TTL_HOURS = 24;
const MAX_PER_RUN = 200;
const HUB_AGENT_ID = "hub-protocol";

interface StalePair {
  item_key: string;
  unit: string;
  retailer_id: string;
  retailer_slug: string;
  last_observed_at: string | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();

  // Find stale (item_key, retailer) pairs across the cartesian product of
  // active item keys × the four hardware retailers we mine. Any pair without
  // a fresh observation in the last STALE_THRESHOLD_HOURS qualifies.
  const stale = await db.execute({
    sql: `
      WITH active_keys AS (
        SELECT item_key, unit
        FROM market.item_key_mapping
        WHERE deprecated_at IS NULL
      ),
      mining_retailers AS (
        SELECT id AS retailer_id, slug AS retailer_slug
        FROM market.retailers
        WHERE active = true
          AND slug IN ('bunnings', 'mitre-10', 'reece', 'beaumont-tiles', 'tradelink')
      ),
      pair_latest AS (
        SELECT k.item_key, k.unit, r.retailer_id, r.retailer_slug,
               MAX(po.observed_at) AS last_observed_at
        FROM active_keys k
        CROSS JOIN mining_retailers r
        LEFT JOIN market.item_key_product_links l
          ON l.item_key = k.item_key
         AND l.retailer_id = r.retailer_id
         AND l.deprecated_at IS NULL
        LEFT JOIN market.price_observations po
          ON po.product_id = l.product_id
         AND po.retailer_id = l.retailer_id
        GROUP BY k.item_key, k.unit, r.retailer_id, r.retailer_slug
      )
      SELECT item_key, unit, retailer_id, retailer_slug, last_observed_at
      FROM pair_latest
      WHERE last_observed_at IS NULL
         OR last_observed_at < now() - INTERVAL '${STALE_THRESHOLD_HOURS} hours'
      ORDER BY last_observed_at NULLS FIRST, item_key, retailer_slug
      LIMIT ${MAX_PER_RUN}
    `,
    args: [],
  });

  const reward = WORK_REWARDS.price_observation_mining;
  const expiresAt = new Date(Date.now() + ASSIGNMENT_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const stmts: { sql: string; args: unknown[] }[] = [];
  let opened = 0;
  let skipped = 0;

  for (const row of stale.rows as unknown as StalePair[]) {
    // Skip if an open or claimed assignment already exists for this pair.
    // Match via JSONB payload to avoid double-issuing.
    const existing = await db.execute({
      sql: `SELECT 1 AS one
            FROM agent_work_assignments
            WHERE work_type = 'price_observation_mining'
              AND status IN ('open', 'claimed')
              AND payload->>'itemKey' = ?
              AND payload->>'retailerSlug' = ?
              AND expires_at > now()
            LIMIT 1`,
      args: [row.item_key, row.retailer_slug],
    });
    if (existing.rows.length > 0) {
      skipped += 1;
      continue;
    }

    const id = randomUUID();
    stmts.push({
      sql: `INSERT INTO agent_work_assignments
              (id, agent_id, work_type, payload, reward_credits, status, expires_at)
            VALUES (?, ?, 'price_observation_mining', ?, ?, 'open', ?)`,
      args: [
        id,
        HUB_AGENT_ID,
        JSON.stringify({
          itemKey: row.item_key,
          retailerSlug: row.retailer_slug,
          expectedUnit: row.unit,
          lastObservedAt: row.last_observed_at,
          bountySource: "cron.quote-rates-assignments",
        }),
        reward,
        expiresAt,
      ],
    });
    opened += 1;
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return NextResponse.json({
    checked: stale.rows.length,
    opened,
    skipped,
    rewardPerAssignment: reward,
    expiresAt,
    cap: MAX_PER_RUN,
    staleThresholdHours: STALE_THRESHOLD_HOURS,
  });
}
