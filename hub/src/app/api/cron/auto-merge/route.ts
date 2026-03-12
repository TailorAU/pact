import { NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";

/**
 * Trigger Silence=Consent auto-merge for all expired proposals.
 * Proposals whose TTL has passed with no objections get auto-merged.
 * Can be called as a cron job or manually.
 */
export async function GET() {
  const db = await getDb();
  const merged = await autoMergeExpired(db);

  return NextResponse.json({
    merged,
    message: `Auto-merged ${merged} proposal(s) via Silence=Consent`,
    timestamp: new Date().toISOString(),
  });
}
