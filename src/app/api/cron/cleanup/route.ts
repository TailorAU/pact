export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb, runConsensusSweep } from "@/lib/db";
import { classifyClaimAtomicity } from "@/lib/claim";
import { ensureLegacySplitBounty } from "@/lib/economy";

/**
 * Cron job: runs daily at 3am UTC (triggered by GitHub Actions).
 * - Purges events older than 30 days
 * - Purges resolved proposals older than 90 days
 * - Cleans up stale registrations (left > 90 days ago)
 * - #3691 W6: read-only atomicity backfill (classify, NEVER truncate or
 *   auto-split) + seeds the legacy-split bounty on needs_split claims
 *
 * Protected by CRON_SECRET.
 */
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

  // 1. Purge UNCHAINED events older than 30 days.
  //
  // #5566 — `sequence_number IS NULL` is load-bearing, not a filter for
  // tidiness. Chained events carry a §6.4 provenance chain, and §6.4 is
  // explicit that "Sequence numbers are never reused, never reassigned, and
  // never skipped. A compacted or tombstoned event retains its position —
  // compaction replaces payload content, not chain position." Deleting a
  // chained row punches a permanent, unrecoverable gap into its resource's
  // chain, which every verifier would then (correctly) report as evidence of
  // tampering. So this purge keeps doing exactly what it always did to the
  // pre-#5566 unchained backlog, and stops at the chain.
  //
  // The §6.3 retention policy for the chained stream (declared minimum,
  // tombstone-in-place rather than delete) is deliberately follow-on work —
  // #5566 lists retention/tombstone policy as out of scope. Until it lands,
  // the honest behaviour is to retain the chain, not to shred it.
  const eventsResult = await db.execute(
    `DELETE FROM events WHERE sequence_number IS NULL AND created_at < NOW() - INTERVAL '30 days'`
  );

  // 2. Purge resolved (merged/rejected) proposals older than 90 days
  const proposalsResult = await db.execute(
    `DELETE FROM proposals WHERE status IN ('merged', 'rejected') AND resolved_at < NOW() - INTERVAL '90 days'`
  );

  // 3. Clean up stale registrations (agent left > 90 days ago)
  const regsResult = await db.execute(
    `DELETE FROM registrations WHERE left_at IS NOT NULL AND left_at < NOW() - INTERVAL '90 days'`
  );

  // 4. Clean up expired invite tokens with zero remaining uses
  const tokensResult = await db.execute(
    `DELETE FROM invite_tokens WHERE uses >= max_uses`
  );

  // 5. Consensus sweep (Silence=Consent auto-merge + topic-proposal
  // approve/reject evaluation + promotion/demotion + challenges) — #5425:
  // cron is the sole engine invoker, under a Postgres advisory lock.
  const sweep = await runConsensusSweep();
  const autoMerged = sweep.merged;

  // 6. #3691 W6 — read-only atomicity backfill. Classifies unclassified
  // canonical claims in bounded batches; rows keep their full text
  // untouched (splitting a bundled claim is a consensus judgement paid via
  // the legacy-split bounty, never a migration script). Rows without a
  // claim stay NULL (= legacy_unchecked).
  let claimsClassified = 0;
  let splitBountiesSeeded = 0;
  const unclassified = await db.execute(
    `SELECT id, canonical_claim FROM topics
     WHERE canonical_claim IS NOT NULL AND claim_atomicity_status IS NULL
     LIMIT 200`
  );
  for (const row of unclassified.rows) {
    const status = classifyClaimAtomicity(row.canonical_claim as string);
    await db.execute({
      sql: "UPDATE topics SET claim_atomicity_status = ? WHERE id = ?",
      args: [status, row.id as string],
    });
    claimsClassified++;
    if (status === "needs_split") {
      try {
        if (await ensureLegacySplitBounty(db, row.id as string)) splitBountiesSeeded++;
      } catch (e) {
        console.error(`legacy-split bounty seed failed for ${row.id}:`, e);
      }
    }
  }

  const summary = {
    message: "Cleanup complete",
    timestamp: new Date().toISOString(),
    eventsDeleted: eventsResult.rowsAffected ?? 0,
    proposalsDeleted: proposalsResult.rowsAffected ?? 0,
    registrationsDeleted: regsResult.rowsAffected ?? 0,
    tokensDeleted: tokensResult.rowsAffected ?? 0,
    autoMerged,
    sweepRan: sweep.ran,
    claimsClassified,
    splitBountiesSeeded,
  };

  return NextResponse.json(summary);
}
