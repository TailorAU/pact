export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { runLegislationSync } from "@/lib/legislation-sync";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: syncs legislation from official government APIs.
 * Triggered weekly by GitHub Actions (or on-demand via workflow_dispatch).
 *
 * Query params:
 *   ?jurisdiction=CTH,QLD  — comma-separated list (default: all configured)
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
