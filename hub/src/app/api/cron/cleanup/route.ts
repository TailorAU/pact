import { NextRequest, NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";

/**
 * Cron job: runs daily at 3am UTC (configured in vercel.json).
 * - Purges events older than 30 days
 * - Purges resolved proposals older than 90 days
 * - Cleans up stale registrations (left > 90 days ago)
 *
 * Protected by CRON_SECRET so only Vercel cron can call it.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret — Vercel sends this header automatically
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();

  // 1. Purge events older than 30 days
  const eventsResult = await db.execute(
    `DELETE FROM events WHERE created_at < datetime('now', '-30 days')`
  );

  // 2. Purge resolved (merged/rejected) proposals older than 90 days
  const proposalsResult = await db.execute(
    `DELETE FROM proposals WHERE status IN ('merged', 'rejected') AND resolved_at < datetime('now', '-90 days')`
  );

  // 3. Clean up stale registrations (agent left > 90 days ago)
  const regsResult = await db.execute(
    `DELETE FROM registrations WHERE left_at IS NOT NULL AND left_at < datetime('now', '-90 days')`
  );

  // 4. Clean up expired invite tokens with zero remaining uses
  const tokensResult = await db.execute(
    `DELETE FROM invite_tokens WHERE uses >= max_uses`
  );

  // 5. Auto-merge expired proposals (Silence=Consent)
  const autoMerged = await autoMergeExpired(db);

  const summary = {
    message: "Cleanup complete",
    timestamp: new Date().toISOString(),
    eventsDeleted: eventsResult.rows.length ?? 0,
    proposalsDeleted: proposalsResult.rows.length ?? 0,
    registrationsDeleted: regsResult.rows.length ?? 0,
    tokensDeleted: tokensResult.rows.length ?? 0,
    autoMerged,
  };

  return NextResponse.json(summary);
}
