import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST: Wipe all data and re-initialize the schema.
// Only works in development or with the correct admin secret.
// This is needed because Vercel in-memory DBs persist across warm function invocations.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const isLocal = !process.env.VERCEL;

  // In production, require admin secret
  if (!isLocal && secret !== "pact-admin-reset-2026") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();

  // Get all table names
  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_litestream_seq'"
  );

  // Delete data from all tables (order matters due to foreign keys)
  const deleteOrder = [
    "assumption_declarations",
    "axiom_usage_logs",
    "api_keys",
    "topic_bounties",
    "ledger_txs",
    "votes",
    "proposals",
    "salience",
    "constraints_table",
    "intents",
    "events",
    "invite_tokens",
    "topic_votes",
    "topic_dependencies",
    "registrations",
    "sections",
    "agent_wallets",
    "agents",
    "topics",
  ];

  let deleted = 0;
  for (const table of deleteOrder) {
    try {
      await db.execute(`DELETE FROM ${table}`);
      deleted++;
    } catch {
      // Table might not exist yet — skip
    }
  }

  // Re-insert hub-protocol wallet
  try {
    await db.execute("INSERT OR IGNORE INTO agent_wallets (agent_id, balance) VALUES ('hub-protocol', 0)");
  } catch { /* ignore */ }

  return NextResponse.json({
    message: "Database wiped successfully.",
    tablesCleared: deleted,
    availableTables: tables.rows.map(r => r.name),
  });
}
