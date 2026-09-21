export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { LEGISLATION_SYNC_LOCK_KEY } from "@/lib/db";
import { startDetachedJob } from "@/lib/detached-jobs";
import { DEFAULT_LEGISLATION_JURISDICTIONS, runLegislationSync } from "@/lib/legislation-sync";
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
 * polls `GET /api/cron/legislation-sync/status` for the outcome.
 *
 * Query params:
 *   ?jurisdiction=CTH,QLD  — comma-separated list (default: all configured)
 *   ?wait=1                — run synchronously and answer 200 with the
 *                            results (local use and tests; takes no lock)
 *
 * Responses:
 *   202 { started: true, jobId, startedAt, jurisdictions }
 *   202 { started: false, running: true, jurisdictions }  — lock already held
 *   200 { message, results }                               — ?wait=1 only
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

  if (req.nextUrl.searchParams.get("wait") !== "1") {
    const start = await startDetachedJob({
      name: "legislation-sync",
      lockKey: LEGISLATION_SYNC_LOCK_KEY,
      run: () => runLegislationSync(jurisdictions),
    });
    return NextResponse.json(
      { ...start, jurisdictions: jurisdictions ?? [...DEFAULT_LEGISLATION_JURISDICTIONS] },
      { status: 202 }
    );
  }

  try {
    const results = await runLegislationSync(jurisdictions);

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
