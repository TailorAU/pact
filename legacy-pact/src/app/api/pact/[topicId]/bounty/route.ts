import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { transfer, ensureWallet } from "@/lib/economy";
import { v4 as uuid } from "uuid";

// GET: View bounty info for a topic (no auth required)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  const escrowResult = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) as total FROM topic_bounties WHERE topic_id = ? AND status = 'escrow'",
    args: [topicId],
  });
  const paidResult = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) as total FROM topic_bounties WHERE topic_id = ? AND status = 'paid'",
    args: [topicId],
  });

  const bountiesResult = await db.execute({
    sql: `SELECT tb.id, tb.amount, tb.status, tb.created_at,
      CASE WHEN tb.sponsor_id = 'hub-protocol' THEN 'Hub Protocol' ELSE a.name END as sponsorName
      FROM topic_bounties tb
      LEFT JOIN agents a ON a.id = tb.sponsor_id
      WHERE tb.topic_id = ?
      ORDER BY tb.created_at DESC
      LIMIT 20`,
    args: [topicId],
  });

  return NextResponse.json({
    escrow: (escrowResult.rows[0]?.total as number) ?? 0,
    paid: (paidResult.rows[0]?.total as number) ?? 0,
    bounties: bountiesResult.rows,
  });
}

// POST: Attach a bounty to a topic
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;

  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { amount } = body as { amount?: number };
  if (!amount || typeof amount !== "number" || amount < 10) {
    return NextResponse.json({ error: "amount must be a number >= 10" }, { status: 400 });
  }
  if (amount > 100000) {
    return NextResponse.json({ error: "amount must be <= 100,000" }, { status: 400 });
  }

  const db = await getDb();

  // Check topic exists
  const topicCheck = await db.execute({
    sql: "SELECT id, status FROM topics WHERE id = ?",
    args: [topicId],
  });
  if (topicCheck.rows.length === 0) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  // Ensure wallet exists and check balance
  await ensureWallet(db, agent.id);
  const walletResult = await db.execute({
    sql: "SELECT balance FROM agent_wallets WHERE agent_id = ?",
    args: [agent.id],
  });
  const balance = (walletResult.rows[0]?.balance as number) ?? 0;

  if (balance < amount) {
    return NextResponse.json({
      error: `Insufficient balance. You have ${balance} credits, need ${amount}.`,
    }, { status: 400 });
  }

  // Deduct from wallet
  await db.execute({
    sql: "UPDATE agent_wallets SET balance = balance - ? WHERE agent_id = ?",
    args: [amount, agent.id],
  });

  // Create escrow bounty
  const bountyId = uuid();
  await db.execute({
    sql: "INSERT INTO topic_bounties (id, topic_id, sponsor_id, amount, status) VALUES (?, ?, ?, ?, 'escrow')",
    args: [bountyId, topicId, agent.id, amount],
  });

  // Ledger entry
  await db.execute({
    sql: "INSERT INTO ledger_txs (id, from_wallet, to_wallet, amount, topic_id, reason) VALUES (?, ?, ?, ?, ?, ?)",
    args: [uuid(), agent.id, "escrow", amount, topicId, "bounty-posted"],
  });

  await emitEvent(db, topicId, "pact.bounty.posted", agent.id, "", {
    bountyId,
    amount,
    sponsorName: agent.name,
  });

  return NextResponse.json({
    bountyId,
    amount,
    topicId,
    remainingBalance: balance - amount,
    message: `Bounty of ${amount} credits posted. Funds held in escrow until consensus.`,
  }, { status: 201 });
}
