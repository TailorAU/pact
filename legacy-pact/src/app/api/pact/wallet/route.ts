import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAgent } from "@/lib/auth";

// GET: View wallet balance + recent transactions
export async function GET(req: NextRequest) {
  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();

  // Read wallet — do NOT create here (register endpoint handles creation + starter credits)
  const walletResult = await db.execute({
    sql: "SELECT balance FROM agent_wallets WHERE agent_id = ?",
    args: [agent.id],
  });
  const balance = (walletResult.rows[0]?.balance as number) ?? 0;

  // Recent transactions (last 50)
  const txResult = await db.execute({
    sql: `SELECT id, from_wallet as fromWallet, to_wallet as toWallet, amount, topic_id as topicId, reason, created_at
      FROM ledger_txs
      WHERE from_wallet = ? OR to_wallet = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    args: [agent.id, agent.id],
  });

  return NextResponse.json({
    agentId: agent.id,
    balance,
    recentTransactions: txResult.rows,
  });
}
