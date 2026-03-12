import { v4 as uuid } from "uuid";
import { type DbClient } from "./db";

// ─── Axiom Yield Distribution ────────────────────────────────────────
// Distributes revenue from the Axiom Toll Road (paid API) to contributing agents.
// Runs weekly via Vercel cron.
//
// Revenue split: 20% Hub Protocol fee, 80% to agents
// Sybil-resistant: weighted by DISTINCT API keys (broad adoption), not raw hits.
//
// ALL WRITES ARE BATCHED ATOMICALLY via db.batch().

const HUB_FEE_PCT = 0.20;
const AGENT_POOL_PCT = 0.80;

/**
 * Distribute Axiom Yield for the current period.
 * Processes all unprocessed usage logs.
 */
export async function distributeAxiomYield(
  db: DbClient
): Promise<{ distributed: number; agents: number; totalUsage: number }> {

  // ── Phase 1: READ ──────────────────────────────────────────────────

  // Count total usage (all unprocessed logs)
  // We use a timestamp-based approach: process all logs, then delete them
  const usageResult = await db.execute(
    "SELECT COUNT(*) as total FROM axiom_usage_logs"
  );
  const totalUsage = (usageResult.rows[0]?.total as number) || 0;

  if (totalUsage === 0) {
    return { distributed: 0, agents: 0, totalUsage: 0 };
  }

  // Total revenue = 1 credit per API hit
  const totalRevenue = totalUsage;
  const hubFee = Math.floor(totalRevenue * HUB_FEE_PCT);
  const agentPool = totalRevenue - hubFee;

  if (agentPool <= 0) {
    return { distributed: 0, agents: 0, totalUsage };
  }

  // Sybil-resistant weight calculation per topic
  // Weight = (distinctKeys * 10) + (directHits * 0.1) + (depthBonus * 0.5)
  const topicWeights = await db.execute(`
    SELECT
      aul.topic_id as topicId,
      COUNT(DISTINCT aul.api_key_id) as distinctKeys,
      COUNT(*) as directHits,
      COALESCE((SELECT COUNT(*) FROM topic_dependencies td WHERE td.depends_on = aul.topic_id), 0) as depthBonus
    FROM axiom_usage_logs aul
    GROUP BY aul.topic_id
  `);

  if (topicWeights.rows.length === 0) {
    return { distributed: 0, agents: 0, totalUsage };
  }

  // Calculate weights
  type TopicWeight = { topicId: string; weight: number };
  const weights: TopicWeight[] = topicWeights.rows.map(row => ({
    topicId: row.topicId as string,
    weight: ((row.distinctKeys as number) * 10) +
            ((row.directHits as number) * 0.1) +
            ((row.depthBonus as number) * 0.5),
  }));

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) {
    return { distributed: 0, agents: 0, totalUsage };
  }

  // ── Phase 2: CALCULATE per-agent payouts ───────────────────────────

  // For each weighted topic, find contributing agents
  // Contributors = merged proposal authors + aligned voters
  type AgentPayout = { agentId: string; amount: number };
  const agentPayouts = new Map<string, number>();

  for (const tw of weights) {
    const topicShare = Math.floor(agentPool * (tw.weight / totalWeight));
    if (topicShare === 0) continue;

    // Find contributors for this topic
    const contributors = await db.execute({
      sql: `
        SELECT DISTINCT agent_id FROM (
          SELECT p.agent_id FROM proposals p
            WHERE p.topic_id = ? AND p.status = 'merged'
          UNION
          SELECT r.agent_id FROM registrations r
            WHERE r.topic_id = ? AND r.done_status = 'aligned'
        )`,
      args: [tw.topicId, tw.topicId],
    });

    if (contributors.rows.length === 0) continue;

    // Split topic share equally among contributors
    const perAgent = Math.floor(topicShare / contributors.rows.length);
    if (perAgent === 0) continue;

    for (const row of contributors.rows) {
      const agentId = row.agent_id as string;
      agentPayouts.set(agentId, (agentPayouts.get(agentId) || 0) + perAgent);
    }
  }

  // ── Phase 3: WRITE (atomic batch) ──────────────────────────────────

  const stmts: { sql: string; args: unknown[] }[] = [];

  // Hub Protocol fee
  stmts.push({
    sql: "UPDATE agent_wallets SET balance = balance + ? WHERE agent_id = 'hub-protocol'",
    args: [hubFee],
  });
  stmts.push({
    sql: "INSERT INTO ledger_txs (id, from_wallet, to_wallet, amount, reason) VALUES (?, ?, ?, ?, ?)",
    args: [uuid(), "axiom-revenue", "hub-protocol", hubFee, "axiom-yield-hub-fee"],
  });

  // Agent payouts
  let totalDistributed = hubFee;
  for (const [agentId, amount] of agentPayouts) {
    if (amount <= 0) continue;

    // Ensure wallet exists
    stmts.push({
      sql: "INSERT OR IGNORE INTO agent_wallets (agent_id, balance) VALUES (?, 0)",
      args: [agentId],
    });
    stmts.push({
      sql: "UPDATE agent_wallets SET balance = balance + ? WHERE agent_id = ?",
      args: [amount, agentId],
    });
    stmts.push({
      sql: "INSERT INTO ledger_txs (id, from_wallet, to_wallet, amount, reason) VALUES (?, ?, ?, ?, ?)",
      args: [uuid(), "axiom-revenue", agentId, amount, "axiom-yield-payout"],
    });
    totalDistributed += amount;
  }

  // Clear processed usage logs
  stmts.push({
    sql: "DELETE FROM axiom_usage_logs",
    args: [],
  });

  // Execute all writes atomically
  await db.batch(stmts);

  return {
    distributed: totalDistributed,
    agents: agentPayouts.size,
    totalUsage,
  };
}
