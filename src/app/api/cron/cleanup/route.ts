export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";

/**
 * Cron job: runs daily at 3am UTC (triggered by GitHub Actions).
 * - Purges events older than 30 days
 * - Purges resolved proposals older than 90 days
 * - Cleans up stale registrations (left > 90 days ago)
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

  // 1. Purge events older than 30 days
  const eventsResult = await db.execute(
    `DELETE FROM events WHERE created_at < NOW() - INTERVAL '30 days'`
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

  // 5. Auto-merge expired proposals (Silence=Consent)
  const autoMerged = await autoMergeExpired(db);

  const summary = {
    message: "Cleanup complete",
    timestamp: new Date().toISOString(),
    eventsDeleted: eventsResult.rowsAffected ?? 0,
    proposalsDeleted: proposalsResult.rowsAffected ?? 0,
    registrationsDeleted: regsResult.rowsAffected ?? 0,
    tokensDeleted: tokensResult.rowsAffected ?? 0,
    autoMerged,
  };

  return NextResponse.json(summary);
}
