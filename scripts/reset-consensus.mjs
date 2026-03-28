// Reset old "consensus" statuses and re-evaluate with new 99% threshold
import { createClient } from "@libsql/client/http";

const db = createClient({
  url: "libsql://pact-tailor-aus.aws-ap-northeast-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  // 1. Reset all "consensus" statuses back to "open"
  const before = await db.execute("SELECT id, title, status FROM topics WHERE status IN ('consensus', 'locked')");
  console.log(`\n=== ${before.rows.length} topics currently at consensus/locked ===`);
  for (const t of before.rows) {
    console.log(`  [${t.status}] ${t.title}`);
  }

  await db.execute("UPDATE topics SET status = 'open', locked_at = NULL, consensus_ratio = NULL, consensus_voters = NULL WHERE status IN ('consensus', 'locked')");
  console.log(`\nReset ${before.rows.length} topics to 'open'\n`);

  // 2. Now evaluate with new 99% threshold + minimum voters
  const THRESHOLDS = {
    axiom: { ratio: 0.99, minVoters: 3 },
    convention: { ratio: 0.99, minVoters: 5 },
    practice: { ratio: 0.99, minVoters: 5 },
    policy: { ratio: 0.99, minVoters: 7 },
    frontier: { ratio: 0.99, minVoters: 10 },
  };

  const topics = await db.execute(`
    SELECT t.id, t.title, t.tier, t.status,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id) as totalProposals,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'merged') as mergedCount,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'pending') as pendingCount,
      (SELECT COUNT(DISTINCT v.agent_id) FROM votes v
        JOIN proposals p ON p.id = v.proposal_id
        WHERE p.topic_id = t.id) as uniqueVoters,
      (SELECT COUNT(DISTINCT p.agent_id) FROM proposals p WHERE p.topic_id = t.id) as uniqueProposers
    FROM topics t
    WHERE t.status = 'open'
  `);

  console.log("=== Evaluating with new 99% threshold ===\n");

  let locked = 0;
  for (const t of topics.rows) {
    const tier = t.tier || "practice";
    const threshold = THRESHOLDS[tier] ?? THRESHOLDS.practice;
    const total = Number(t.totalProposals) || 0;
    const merged = Number(t.mergedCount) || 0;
    const pending = Number(t.pendingCount) || 0;
    const uniqueVoters = Number(t.uniqueVoters) || 0;
    const uniqueProposers = Number(t.uniqueProposers) || 0;
    const uniqueParticipants = Math.max(uniqueVoters, uniqueProposers);
    const ratio = total > 0 ? merged / total : 0;

    const meetsRatio = ratio >= threshold.ratio;
    const meetsVoters = uniqueParticipants >= threshold.minVoters;
    const noPending = pending === 0;
    const hasProposals = total > 0 && merged > 0;

    const willLock = hasProposals && noPending && meetsRatio && meetsVoters;

    console.log(`  ${willLock ? "🔒" : "⬜"} [${tier}] ${t.title}`);
    console.log(`     Ratio: ${Math.round(ratio * 100)}% (need ${Math.round(threshold.ratio * 100)}%) ${meetsRatio ? "✓" : "✗"}`);
    console.log(`     Voters: ${uniqueParticipants} (need ${threshold.minVoters}) ${meetsVoters ? "✓" : "✗"}`);
    console.log(`     Pending: ${pending} ${noPending ? "✓" : "✗"}`);

    if (willLock) {
      await db.execute({
        sql: "UPDATE topics SET status = 'locked', locked_at = datetime('now'), consensus_ratio = ?, consensus_voters = ? WHERE id = ?",
        args: [ratio, uniqueParticipants, t.id],
      });
      locked++;
    }
    console.log("");
  }

  console.log(`=== Result: ${locked}/${topics.rows.length} topics locked with 99% consensus ===`);
}

main().catch(console.error);
