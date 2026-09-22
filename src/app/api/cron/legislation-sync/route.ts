export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { LEGISLATION_SYNC_LOCK_KEY } from "@/lib/db";
import { runJobInline, startDetachedJob, type JobOutcome } from "@/lib/detached-jobs";
import { DEFAULT_LEGISLATION_JURISDICTIONS, runLegislationSync, type SyncResult } from "@/lib/legislation-sync";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: syncs legislation from official government APIs.
 * Triggered weekly by GitHub Actions (or on-demand via workflow_dispatch).
 *
 * tailor-group#38 — the sync takes minutes, and pact.tailor.au sits behind
 * a Next.js rewrite proxy with a 30 s timeout that answered the old
 * synchronous route with a bare 500 every time. By default the route now
 * starts the sync DETACHED under the `LEGISLATION_SYNC_LOCK_KEY` advisory
 * lock (single flight across replicas) and answers 202 at once; the caller
 * polls `GET /api/cron/legislation-sync/status` for the outcome. The run's
 * `cron_job_runs` row records `ok` = no jurisdiction reported an error, and
 * a summary with each jurisdiction's counts and FIRST error string, so a
 * credentials failure that leaves `docsChecked=0 errors=1` is readable from
 * the status route and the workflow log, not just countable.
 *
 * Query params:
 *   ?jurisdiction=CTH,QLD  — comma-separated list (default: all configured)
 *   ?wait=1                — run synchronously and answer 200 with the
 *                            results (local use and tests). Same lock: a
 *                            wait run never overlaps a detached one.
 *
 * Responses:
 *   202 { started: true, jobId, startedAt, jurisdictions }
 *   202 { started: false, running: true, jurisdictions }  — lock already held
 *                                                            (either mode)
 *   200 { message, results }                               — ?wait=1 only
 *   500 { error }                                          — ?wait=1 threw
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

  const jurisdictionParam = req.nextUrl.searchParams.get("jurisdiction");
  const jurisdictions = jurisdictionParam
    ? jurisdictionParam.split(",").map(j => j.trim().toUpperCase())
    : undefined;
  const targeted = jurisdictions ?? [...DEFAULT_LEGISLATION_JURISDICTIONS];

  const job = {
    name: "legislation-sync",
    lockKey: LEGISLATION_SYNC_LOCK_KEY,
    run: () => runLegislationSync(jurisdictions),
    outcome: legislationOutcome,
  };

  if (req.nextUrl.searchParams.get("wait") !== "1") {
    const start = await startDetachedJob(job);
    return NextResponse.json({ ...start, jurisdictions: targeted }, { status: 202 });
  }

  try {
    const outcome = await runJobInline(job);
    if (!outcome.started) {
      return NextResponse.json({ started: false, running: true, jurisdictions: targeted }, { status: 202 });
    }
    const results = outcome.result;

    const totalUpdated = results.reduce((sum, r) => sum + r.docsUpdated, 0);
    const totalSections = results.reduce((sum, r) => sum + r.sectionsTotal, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    return NextResponse.json({
      message: `Legislation sync complete: ${totalUpdated} docs updated, ${totalSections} sections, ${totalErrors} errors`,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Legislation sync failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}

/** `ok` iff no jurisdiction reported an error; the summary keeps each one's counts and first error text. */
function legislationOutcome(results: SyncResult[]): JobOutcome {
  return {
    ok: results.every(r => r.errors.length === 0),
    summary: {
      jurisdictions: results.map(r => ({
        jurisdiction: r.jurisdiction,
        docsChecked: r.docsChecked,
        docsUpdated: r.docsUpdated,
        sectionsTotal: r.sectionsTotal,
        errorCount: r.errors.length,
        firstError: r.errors[0] ?? null,
        parserCrashCount: r.parserCrashCount,
        parserAnomalyCount: r.parserAnomalyCount,
      })),
    },
  };
}
