export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb, FISCAL_SYNC_LOCK_KEY } from "@/lib/db";
import { runJobInline, startDetachedJob, type JobOutcome } from "@/lib/detached-jobs";
import { runFiscalSync, type FiscalSyncResult } from "@/lib/fiscal-sync";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: nightly QLD fiscal reconstruction (#3053).
 * Reconstructs the QLD General Government operating statement from public data
 * and refreshes the pre-registered FY2026-27 forecast node. Upserts fiscal_line
 * / fiscal_forecast and writes a fiscal_sync_log audit row.
 * Triggered nightly at 18:00 UTC (4am AEST) by GitHub Actions cron.yml.
 *
 * tailor-group#38 — pact.tailor.au sits behind a Next.js rewrite proxy with
 * a 30 s timeout, so the route no longer runs the sync inside the request.
 * By default it starts the sync DETACHED under the `FISCAL_SYNC_LOCK_KEY`
 * advisory lock (single flight across replicas) and answers 202 at once;
 * the caller polls `GET /api/cron/fiscal-sync/status`. The run's
 * `cron_job_runs` row records `ok` = `result.status !== "error"` — the same
 * verdict the synchronous route used for its 500 (nothing written AND
 * errors) — with the status, counts and `errorDetail` in the summary.
 *
 * Query params:
 *   ?jurisdiction=QLD  — default QLD
 *   ?wait=1            — run synchronously: 200 (or 500 when status is
 *                        "error") with the result. Same lock as detached.
 *
 * Responses:
 *   202 { started: true, jobId, startedAt, jurisdiction }
 *   202 { started: false, running: true, jurisdiction }  — lock already held
 *   200 / 500 { message, result, timestamp }             — ?wait=1 only
 *   500 { error, message, timestamp }                    — ?wait=1 threw
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

  const jurisdiction = req.nextUrl.searchParams.get("jurisdiction") ?? "QLD";

  const job = {
    name: "fiscal-sync",
    lockKey: FISCAL_SYNC_LOCK_KEY,
    run: async () => runFiscalSync(await getDb(), { jurisdiction }),
    outcome: fiscalOutcome,
  };

  if (req.nextUrl.searchParams.get("wait") !== "1") {
    const start = await startDetachedJob(job);
    return NextResponse.json({ ...start, jurisdiction }, { status: 202 });
  }

  let result: FiscalSyncResult;
  try {
    const outcome = await runJobInline(job);
    if (!outcome.started) {
      return NextResponse.json({ started: false, running: true, jurisdiction }, { status: 202 });
    }
    result = outcome.result;
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

/** `ok` iff the sync did not end in status "error"; the summary keeps status, counts and errorDetail. */
function fiscalOutcome(result: FiscalSyncResult): JobOutcome {
  return {
    ok: result.status !== "error",
    summary: {
      jurisdiction: result.jurisdiction,
      status: result.status,
      linesWritten: result.linesWritten,
      forecastLinesWritten: result.forecastLinesWritten,
      errorDetail: result.errorDetail ?? null,
    },
  };
}
