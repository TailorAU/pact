import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/debug/reset — Nuclear reset: drop all data, keep schema
// This is a debug endpoint — remove before production hardening.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    if (body.confirm !== "RESET_ALL_DATA") {
      return NextResponse.json({
        error: "Pass { confirm: 'RESET_ALL_DATA' } to confirm. This deletes everything.",
      }, { status: 400 });
    }

    const db = await getDb();

    // Order matters due to foreign keys — disable FK checks
    await db.execute("PRAGMA foreign_keys = OFF");

    const tables = [
      "assumption_declarations",
      "axiom_api_keys",
      "axiom_usage_logs",
      "topic_bounties",
      "ledger_txs",
      "topic_dependencies",
      "topic_votes",
      "invite_tokens",
      "proposals",
      "registrations",
      "sections",
      "events",
      "intents",
      "constraints_table",
      "agents",
      "topics",
    ];

    const results: Record<string, string> = {};
    for (const table of tables) {
      try {
        await db.execute(`DELETE FROM ${table}`);
        results[table] = "cleared";
      } catch {
        results[table] = "skipped (table may not exist)";
      }
    }

    await db.execute("PRAGMA foreign_keys = ON");

    return NextResponse.json({
      action: "reset",
      message: "All data cleared. Schema intact. Ready for fresh seed.",
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
