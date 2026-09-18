export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { distributeAxiomYield } from "@/lib/yield";
import { log } from "@/lib/logger";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: runs weekly on Sundays at 4am UTC (triggered by GitHub Actions).
 * Distributes Axiom Yield — revenue from the paid Axiom API to contributing agents.
 *
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (!safeSecretEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();

  try {
    const result = await distributeAxiomYield(db);

    return NextResponse.json({
      message: "Axiom Yield distribution complete",
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    log.error({ op: "cron.yield.distribute.error", err: error }, "Axiom Yield distribution failed");
    return NextResponse.json({
      error: "Yield distribution failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
