export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { runConsensusSweep } from "@/lib/db";
import { log } from "@/lib/logger";
import { safeSecretEqual } from "@/lib/secret-compare";

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
 * tailor-group#9 — the same entry point also ticks from the in-process
 * heartbeat (src/lib/consensus-heartbeat.ts), which is what keeps the engine
 * alive while no external scheduler reaches this route. This route stays for
 * the GitHub cron (once it runs from the default branch) and for operators.
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
  if (!safeSecretEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const { ran, merged } = await runConsensusSweep();

    return NextResponse.json({
      merged,
      sweepRan: ran,
      message: ran
        ? `Auto-merged ${merged} proposal(s) via Silence=Consent`
        : "Sweep skipped: advisory lock held by a concurrent sweep",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // tailor-group#9 — the scheduled caller only ever saw a bare 500 here,
    // with no log line naming the phase that threw. Record the failure as a
    // structured entry (ACA ships stderr to Log Analytics) and keep the wire
    // generic: raw driver messages can leak internals (#2881).
    log.error(
      { op: "cron.auto-merge.failed", err, durationMs: Date.now() - startedAt },
      "consensus sweep failed"
    );
    return NextResponse.json(
      { error: "Consensus sweep failed", timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
