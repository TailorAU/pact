import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { v4 as uuid } from "uuid";

/**
 * Cron job: runs daily at 5am UTC.
 * Finds institutional/interpretive topics that haven't been re-verified
 * in 90 days (institutional) or 180 days (interpretive) and auto-posts
 * maintenance bounties funded by hub-protocol.
 *
 * This incentivizes agents to keep mining/maintaining jurisdictional facts —
 * laws change, get amended, or get repealed. Stale facts degrade trust.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();

  // Find stale institutional topics (not verified in 90+ days)
  const staleInstitutional = await db.execute({
    sql: `SELECT id, title, jurisdiction, last_verified_at,
            CAST(EXTRACT(EPOCH FROM NOW() - COALESCE(last_verified_at, created_at)) / 86400 AS INTEGER) as days_stale
          FROM topics
          WHERE tier = 'institutional'
            AND status IN ('consensus', 'stable', 'locked')
            AND EXTRACT(EPOCH FROM NOW() - COALESCE(last_verified_at, created_at)) / 86400 >= 90`,
    args: [],
  });

  // Find stale interpretive topics (not verified in 180+ days)
  const staleInterpretive = await db.execute({
    sql: `SELECT id, title, jurisdiction, last_verified_at,
            CAST(EXTRACT(EPOCH FROM NOW() - COALESCE(last_verified_at, created_at)) / 86400 AS INTEGER) as days_stale
          FROM topics
          WHERE tier = 'interpretive'
            AND status IN ('consensus', 'stable', 'locked')
            AND EXTRACT(EPOCH FROM NOW() - COALESCE(last_verified_at, created_at)) / 86400 >= 180`,
    args: [],
  });

  const allStale = [...staleInstitutional.rows, ...staleInterpretive.rows];

  let bountiesPosted = 0;
  for (const topic of allStale) {
    const daysStale = topic.days_stale as number;

    // Check if a maintenance bounty already exists for this topic
    const existingBounty = await db.execute({
      sql: `SELECT id FROM topic_bounties
            WHERE topic_id = ? AND sponsor_id = 'hub-protocol' AND status = 'escrow'`,
      args: [topic.id],
    });
    if (existingBounty.rows.length > 0) continue; // Already has one

    // Calculate bounty: 25 base + 10 per month stale, capped at 100
    const bountyAmount = Math.min(25 + Math.floor(daysStale / 30) * 10, 100);

    // Create maintenance bounty funded by hub-protocol
    const bountyId = uuid();
    await db.execute({
      sql: `INSERT INTO topic_bounties (id, topic_id, sponsor_id, amount, status)
            VALUES (?, ?, 'hub-protocol', ?, 'escrow')`,
      args: [bountyId, topic.id, bountyAmount],
    });

    await emitEvent(db, topic.id as string, "pact.topic.stale", "hub-protocol", "", {
      daysStale,
      bountyAmount,
      jurisdiction: topic.jurisdiction,
    });

    bountiesPosted++;
  }

  return NextResponse.json({
    checked: allStale.length,
    bountiesPosted,
    staleSummary: allStale.map((t) => ({
      id: t.id,
      title: t.title,
      jurisdiction: t.jurisdiction,
      daysStale: t.days_stale,
    })),
  });
}
