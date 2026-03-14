import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { TIER_BASE_AGENTS } from "@/lib/db";

// GET /api/debug/consensus?topicId=xxx — Debug why a topic hasn't reached consensus
export async function GET(req: NextRequest) {
  const topicId = req.nextUrl.searchParams.get("topicId");
  const db = await getDb();

  const query = topicId
    ? {
        sql: `SELECT t.id, t.status, t.tier, t.consensus_since,
          (SELECT COUNT(DISTINCT p.agent_id) FROM proposals p
            WHERE p.topic_id = t.id AND p.status != 'rejected') as uniqueProposers,
          (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'pending') as pendingCount,
          (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'merged') as mergedCount,
          (SELECT COUNT(*) FROM proposals p
            JOIN sections s ON s.id = p.section_id AND s.topic_id = p.topic_id
            WHERE p.topic_id = t.id AND p.status = 'merged' AND s.heading = 'Answer') as answerMergedCount,
          (SELECT COUNT(*) FROM registrations r
            WHERE r.topic_id = t.id AND r.done_status = 'aligned') as alignedCount,
          (SELECT COUNT(*) FROM registrations r
            WHERE r.topic_id = t.id AND r.done_status = 'dissenting') as dissentingCount,
          (SELECT COUNT(*) FROM topic_dependencies td
            JOIN topics dep ON dep.id = td.depends_on
            WHERE td.topic_id = t.id
            AND dep.status NOT IN ('consensus', 'stable')) as unmetDependencies
        FROM topics t WHERE t.id = ?`,
        args: [topicId],
      }
    : {
        sql: `SELECT t.id, t.title, t.status, t.tier,
          (SELECT COUNT(DISTINCT p.agent_id) FROM proposals p
            WHERE p.topic_id = t.id AND p.status != 'rejected') as uniqueProposers,
          (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'pending') as pendingCount,
          (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'merged') as mergedCount,
          (SELECT COUNT(*) FROM proposals p
            JOIN sections s ON s.id = p.section_id AND s.topic_id = p.topic_id
            WHERE p.topic_id = t.id AND p.status = 'merged' AND s.heading = 'Answer') as answerMergedCount,
          (SELECT COUNT(*) FROM registrations r
            WHERE r.topic_id = t.id AND r.done_status = 'aligned') as alignedCount,
          (SELECT COUNT(*) FROM registrations r
            WHERE r.topic_id = t.id AND r.done_status = 'dissenting') as dissentingCount,
          (SELECT COUNT(*) FROM topic_dependencies td
            JOIN topics dep ON dep.id = td.depends_on
            WHERE td.topic_id = t.id
            AND dep.status NOT IN ('consensus', 'stable')) as unmetDependencies
        FROM topics t WHERE t.status IN ('open', 'challenged') LIMIT 10`,
        args: [],
      };

  const result = await db.execute(query);

  const analysis = result.rows.map((t) => {
    const tier = (t.tier as string) || "practice";
    const base = TIER_BASE_AGENTS[tier] ?? 3;
    const uniqueProposers = t.uniqueProposers as number;
    const requiredAgents = Math.max(base, uniqueProposers);
    const aligned = t.alignedCount as number;
    const dissenting = t.dissentingCount as number;
    const totalVoters = aligned + dissenting;
    const ratio = totalVoters > 0 ? aligned / totalVoters : 0;
    const pending = t.pendingCount as number;
    const answerMerged = t.answerMergedCount as number;
    const unmetDeps = t.unmetDependencies as number;

    const checks = {
      pendingZero: pending === 0,
      answerMerged: answerMerged > 0,
      enoughAligned: aligned >= requiredAgents,
      supermajority: ratio >= 0.9,
      depsCleared: unmetDeps === 0,
    };

    return {
      id: t.id,
      title: t.title,
      tier,
      status: t.status,
      uniqueProposers,
      pending,
      mergedCount: t.mergedCount,
      answerMerged,
      aligned,
      dissenting,
      totalVoters,
      ratio: Math.round(ratio * 100) + "%",
      requiredAgents,
      unmetDeps,
      checks,
      wouldFlip: Object.values(checks).every(Boolean),
    };
  });

  return NextResponse.json(analysis);
}
