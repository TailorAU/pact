export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb, runConsensusSweep, withTransaction } from "@/lib/db";
import { classifyClaimAtomicity } from "@/lib/claim";
import { ensureLegacySplitBounty } from "@/lib/economy";
import { log } from "@/lib/logger";
import {
  CHAIN_META_ORIGIN_PRE_PURGE_SWEEP,
  buildUnchainedEventPurge,
  buildUnchainedHistoryStamp,
  readUnchainedPurgeResult,
} from "@/lib/retention";

/**
 * Cron job: runs daily at 3am UTC (triggered by GitHub Actions).
 * - #5598: latches every resource holding UNCHAINED (pre-#5566) events into
 *   `resource_chain_meta`, then purges unchained events older than 30 days,
 *   stamping that same table inside the SAME statement
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

  // 1. UNCHAINED-event retention (#5598) — TWO statements, in this order.
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
  // #5598 — the SQL itself now lives in the pure `@/lib/retention` seam, so
  // the §6.3 `retentionPolicy` that `pact-profile.ts` advertises and the bound
  // actually enforced here derive from ONE constant and cannot drift apart.

  // 1a. PRE-PASS — latch every resource that CURRENTLY holds ANY unchained
  // row, not merely the rows already past the 30-day boundary, so the
  // `resource_chain_meta` row exists well before those rows reach the deletion
  // boundary. Deletes nothing.
  //
  // DIAGNOSTIC, NOT LOAD-BEARING. #5598 first shipped this comment claiming
  // the pre-pass is what lets a resource purged before its first chained
  // append write GENESIS-UNCHAINED instead of a false GENESIS. It is not: 1b
  // below stamps the latch in the SAME statement as the delete, so that case
  // is already covered with no pre-pass at all (the Defect-2 end-to-end test
  // in provenance-chain.test.ts proves it by running the purge alone). What
  // this pass actually buys is an earlier `first_observed_at`, an `origin`
  // that says we knew before the purge rather than at the moment of deletion,
  // and `last_purged_at IS NULL` to tell the two apart afterwards.
  //
  // Which is why it runs in its OWN try/catch. It is an unbounded sequential
  // scan of `events` — `idx_events_topic_sequence` is `(topic_id,
  // sequence_number)`, so a bare `sequence_number IS NULL` predicate cannot
  // seek on it — and this estate has a ~30s edge ceiling. Letting a slow or
  // failed diagnostic scan escape here would 500 the handler before step 1b's
  // purge, before the 90-day proposal and registration sweeps, and before step
  // 5's consensus sweep, which #5425 makes the cron the SOLE invoker of. A
  // diagnostic must never be able to stop the engine.
  //
  // `ON CONFLICT DO NOTHING`, never DO UPDATE — the latch is presence-only and
  // monotonic: re-stamping every day must not reset `unchained_purged_count`,
  // must not move `first_observed_at`, and must not overwrite an earlier
  // `origin`.
  //
  // Count = `rows.length`: the statement RETURNs one row per row actually
  // inserted. This one IS a plain INSERT, so `rowsAffected` would be correct
  // here too — `rows.length` is used anyway so nobody has to remember which of
  // these two statements is the one where `rowsAffected` lies (see 1b).
  let resourcesLatched = 0;
  let latchSweepFailed = false;
  try {
    const stampResult = await db.execute(
      buildUnchainedHistoryStamp(CHAIN_META_ORIGIN_PRE_PURGE_SWEEP)
    );
    resourcesLatched = stampResult.rows.length;
  } catch (e) {
    // Reported on the wire, not swallowed: the summary below is the only
    // signal this job emits, and a silently skipped sweep would look
    // identical to a sweep that found nothing to latch.
    latchSweepFailed = true;
    log.error(
      { err: e, op: "retention.chain_meta.sweep.failed" },
      "chain-meta pre-purge sweep failed; the purge and the rest of the job continue"
    );
  }

  // 1b. THE PURGE — ONE data-modifying CTE that deletes the expired unchained
  // rows and stamps `resource_chain_meta` in the SAME statement. Every
  // sub-statement of a data-modifying CTE runs against a single snapshot, so
  // there is no instant at which a concurrent reader can observe the DELETE
  // without the stamp — precisely the window in which the evidence would be
  // lost forever if the process died between two separate statements.
  //
  // *** DO NOT READ `rowsAffected` OFF THIS RESULT. ***
  // On a data-modifying CTE `rowsAffected` reports the OUTER SELECT, which is
  // 1 — always, forever, no matter how many events were deleted. The real
  // counts come OUT OF `rows[0]` (`events_deleted` / `resources_stamped`) via
  // `readUnchainedPurgeResult`. Writing `purgeResult.rowsAffected` into the
  // response below would silently report "1 event deleted" every single day,
  // and is exactly the bug this shape exists to make unwritable.
  const purgeResult = await db.execute(buildUnchainedEventPurge());
  const { eventsDeleted, resourcesStamped } = readUnchainedPurgeResult(
    purgeResult.rows
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
        // #5599 PR-C — ONE short transaction PER TOPIC (the sweep's
        // per-decision pattern, never one transaction around the loop): the
        // bounty INSERT, its ledger row and its §6.4 chain link commit
        // together or vanish together, and emitEvent's interlock sees an
        // in-transaction client instead of refusing the pooled one. The kept
        // catch still decides policy — a failed seed rolls back alone, logs,
        // and never blocks the remaining topics.
        const seeded = await withTransaction(db, (tx) =>
          ensureLegacySplitBounty(tx, row.id as string)
        );
        if (seeded) splitBountiesSeeded++;
      } catch (e) {
        console.error(`legacy-split bounty seed failed for ${row.id}:`, e);
      }
    }
  }

  const summary = {
    message: "Cleanup complete",
    timestamp: new Date().toISOString(),
    // #5598 — read OUT OF rows[0] by readUnchainedPurgeResult, never off
    // rowsAffected (which on that CTE is the outer SELECT, i.e. always 1).
    eventsDeleted,
    resourcesLatched,
    latchSweepFailed,
    resourcesStamped,
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
