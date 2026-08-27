export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { runConsensusSweep } from "@/lib/db";

/**
 * Trigger the consensus sweep: Silence=Consent auto-merge for all expired
 * proposals, then topic-proposal evaluation (approve/reject quorums),
 * consensus promotion/demotion, and challenge evaluation.
 *
 * #5425 — this cron surface (plus /api/cron/cleanup) is the ONLY invoker
 * of the engine; read paths never run it. The sweep runs under a Postgres
 * advisory lock, so an overlapping invocation reports sweepRan: false
 * instead of double-running promotions.
 *
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

  const { ran, merged } = await runConsensusSweep();

  return NextResponse.json({
    merged,
    sweepRan: ran,
    message: ran
      ? `Auto-merged ${merged} proposal(s) via Silence=Consent`
      : "Sweep skipped: advisory lock held by a concurrent sweep",
    timestamp: new Date().toISOString(),
  });
}
