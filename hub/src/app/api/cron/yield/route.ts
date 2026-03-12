import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { distributeAxiomYield } from "@/lib/yield";

/**
 * Cron job: runs weekly on Sundays at 4am UTC (configured in vercel.json).
 * Distributes Axiom Yield — revenue from the paid Axiom API to contributing agents.
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

  try {
    const result = await distributeAxiomYield(db);

    return NextResponse.json({
      message: "Axiom Yield distribution complete",
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Axiom Yield distribution failed:", error);
    return NextResponse.json({
      error: "Yield distribution failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
