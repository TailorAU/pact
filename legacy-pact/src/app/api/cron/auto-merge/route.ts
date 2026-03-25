import { NextRequest, NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";

/**
 * Trigger Silence=Consent auto-merge for all expired proposals.
 * Proposals whose TTL has passed with no objections get auto-merged.
 * Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  return GET(req);
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
  const merged = await autoMergeExpired(db);

  return NextResponse.json({
    merged,
    message: `Auto-merged ${merged} proposal(s) via Silence=Consent`,
    timestamp: new Date().toISOString(),
  });
}
