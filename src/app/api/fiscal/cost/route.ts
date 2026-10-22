import { NextResponse } from "next/server";
import { getFiscalComputeCost } from "@/lib/fiscal-queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public, no-auth: total compute cost to establish the QLD 2026-27 AI forecast (#3053).
 * Exercise ledger (subagent tokens measured, main-thread + energy estimated) + the
 * cumulative measured token cost of the nightly cron runs.
 * GET /api/fiscal/cost
 */
export async function GET() {
  try {
    const data = await getFiscalComputeCost();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    log.error({ op: "fiscal.cost.get.error", err }, "fiscal cost query failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
