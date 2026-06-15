export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runFiscalSync } from "@/lib/fiscal-sync";

/**
 * Cron job: nightly QLD fiscal reconstruction (#3053).
 * Reconstructs the QLD General Government operating statement from public data
 * and refreshes the pre-registered FY2026-27 forecast node. Upserts fiscal_line
 * / fiscal_forecast and writes a fiscal_sync_log audit row.
 * Triggered nightly at 18:00 UTC (4am AEST) by GitHub Actions cron-source.yml.
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

  const jurisdiction = req.nextUrl.searchParams.get("jurisdiction") ?? "QLD";

  const db = await getDb();
  let result;
  try {
    result = await runFiscalSync(db, { jurisdiction });
  } catch (e) {
    return NextResponse.json(
      { error: "Fiscal sync failed", message: String(e), timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  // Non-fatal partial failure (mirrors spatial-snapshot): 500 only if nothing
  // was written AND there were errors; otherwise 200 with detail in the body.
  const failed = result.status === "error";
  return NextResponse.json(
    {
      message: `Fiscal sync ${result.status}: ${result.linesWritten} lines + ${result.forecastLinesWritten} forecast lines written`,
      result,
      timestamp: new Date().toISOString(),
    },
    { status: failed ? 500 : 200 }
  );
}

export async function POST(req: NextRequest) {
  return GET(req);
}
