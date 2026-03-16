import { NextResponse } from "next/server";
import { getDb, updateConsensusStatuses, TIER_BASE_AGENTS } from "@/lib/db";

// GET /api/debug/force-consensus — Force consensus evaluation with detailed output
export async function GET() {
  const db = await getDb();

  // Step 1: Run updateConsensusStatuses and capture results
  const beforeResult = await db.execute(`
    SELECT t.id, t.title, t.status, t.tier,
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
    FROM topics t
    WHERE t.status IN ('open', 'challenged')
  `);

  const analysis = [];
  for (const t of beforeResult.rows) {
    const tier = (t.tier as string) || "practice";
    const base = TIER_BASE_AGENTS[tier] ?? 3;
    const uniqueProposers = 1; // simplified
    const requiredAgents = Math.max(base, uniqueProposers);
    const aligned = t.alignedCount as number;
    const dissenting = t.dissentingCount as number;
    const totalVoters = aligned + dissenting;
    const ratio = totalVoters > 0 ? aligned / totalVoters : 0;
    const pending = t.pendingCount as number;
    const answerMerged = t.answerMergedCount as number;
    const unmetDeps = t.unmetDependencies as number;
    const depsOk = tier === "axiom" || unmetDeps === 0;

    const wouldFlip = pending === 0 && answerMerged > 0 && aligned >= requiredAgents && ratio >= 0.9 && depsOk;

    analysis.push({
      id: t.id as string,
      title: (t.title as string).slice(0, 40),
      tier,
      pending,
      answerMerged,
      aligned,
      required: requiredAgents,
      ratio: Math.round(ratio * 100),
      unmetDeps,
      depsOk,
      wouldFlip,
    });
  }

  // Step 2: Try to manually flip topics that should flip
  let manuallyFlipped = 0;
  let errors: string[] = [];

  for (const a of analysis) {
    if (a.wouldFlip) {
      try {
        const check = await db.execute({
          sql: "SELECT id, status FROM topics WHERE id = ?",
          args: [a.id],
        });
        const before = check.rows[0]?.status as string;

        await db.execute({
          sql: `UPDATE topics SET
            status = 'consensus',
            consensus_ratio = ?,
            consensus_voters = ?,
            consensus_since = COALESCE(consensus_since, datetime('now'))
          WHERE id = ?`,
          args: [a.ratio / 100, a.aligned, a.id],
        });

        const verify = await db.execute({
          sql: "SELECT status FROM topics WHERE id = ?",
          args: [a.id],
        });
        const after = verify.rows[0]?.status as string;
        errors.push(`${(a.id as string).slice(0,8)}: ${before} -> ${after}`);
        manuallyFlipped++;
      } catch (e) {
        errors.push(`${(a.id as string).slice(0,8)}: ERROR ${e}`);
      }
    }
  }

  // Re-run updateConsensusStatuses to flip any additional topics
  let updateResult = "ok";
  try {
    await updateConsensusStatuses(db);
  } catch (e) {
    updateResult = `error: ${e}`;
  }

  // Step 3: Check results
  const afterResult = await db.execute(`
    SELECT status, COUNT(*) as c FROM topics GROUP BY status
  `);

  return NextResponse.json({
    before: analysis,
    shouldFlipCount: analysis.filter(a => a.wouldFlip).length,
    manuallyFlipped,
    updateConsensusResult: updateResult,
    errors,
    afterStatuses: afterResult.rows,
  });
}

// POST /api/debug/force-consensus — Force ALL open topics to consensus (bootstrap only)
// Body: { "confirm": "FORCE_ALL" } or { "topicId": "..." }
export async function POST(req: Request) {
  const body = await req.json();
  const db = await getDb();

  if (body.topicId) {
    // Force single topic
    await db.execute({
      sql: `UPDATE topics SET status = 'consensus', consensus_ratio = 1.0, consensus_voters = 3, consensus_since = datetime('now') WHERE id = ?`,
      args: [body.topicId],
    });
    return NextResponse.json({ forced: 1, topicId: body.topicId });
  }

  if (body.confirm !== "FORCE_ALL") {
    return NextResponse.json({ error: "Send { confirm: 'FORCE_ALL' } to force all open topics" }, { status: 400 });
  }

  const result = await db.execute(`UPDATE topics SET status = 'consensus', consensus_ratio = 1.0, consensus_voters = 3, consensus_since = datetime('now') WHERE status IN ('open', 'proposed')`);
  const after = await db.execute(`SELECT status, COUNT(*) as c FROM topics GROUP BY status`);

  return NextResponse.json({ forced: result.rowsAffected, afterStatuses: after.rows });
}
