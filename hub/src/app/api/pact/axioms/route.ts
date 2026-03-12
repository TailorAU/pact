import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { createHash } from "crypto";

// GET: Paid axiom endpoint — returns all verified topics with Answer content.
// Auth: Authorization: Bearer <key> (separate from agent auth)
// Billing: 1 credit per request
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Authorization: Bearer <api_key> required" }, { status: 401 });
  }

  const secret = authHeader.slice(7).trim();
  const secretHash = createHash("sha256").update(secret).digest("hex");

  const db = await getDb();

  // Lookup API key
  const keyResult = await db.execute({
    sql: "SELECT id, credit_balance FROM api_keys WHERE secret_hash = ?",
    args: [secretHash],
  });
  if (keyResult.rows.length === 0) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const apiKey = keyResult.rows[0];
  const balance = apiKey.credit_balance as number;
  const keyId = apiKey.id as string;

  if (balance < 1) {
    return NextResponse.json({
      error: "Insufficient credits. Top up your API key balance.",
      credit_remaining: balance,
    }, { status: 402 });
  }

  // Deduct 1 credit
  await db.execute({
    sql: "UPDATE api_keys SET credit_balance = credit_balance - 1 WHERE id = ?",
    args: [keyId],
  });

  // Fetch all verified topics (consensus/stable) with their Answer content
  const topicsResult = await db.execute(`
    SELECT t.id as topicId, t.title, t.tier, t.status, t.consensus_ratio as consensusRatio,
      (SELECT s.content FROM sections s WHERE s.topic_id = t.id AND s.heading = 'Answer' LIMIT 1) as answer
    FROM topics t
    WHERE t.status IN ('consensus', 'stable')
    ORDER BY t.tier, t.title
  `);

  // For each topic, get dependencies
  const axioms = [];
  for (const topic of topicsResult.rows) {
    const deps = await db.execute({
      sql: `SELECT td.depends_on as topicId, dep.title
        FROM topic_dependencies td
        JOIN topics dep ON dep.id = td.depends_on
        WHERE td.topic_id = ?`,
      args: [topic.topicId as string],
    });

    axioms.push({
      topicId: topic.topicId,
      title: topic.title,
      tier: topic.tier,
      status: topic.status,
      answer: topic.answer,
      consensusRatio: topic.consensusRatio,
      dependencies: deps.rows,
    });

    // Log usage for yield calculation
    await db.execute({
      sql: "INSERT INTO axiom_usage_logs (id, topic_id, api_key_id) VALUES (?, ?, ?)",
      args: [uuid(), topic.topicId as string, keyId],
    });
  }

  return NextResponse.json({
    axioms,
    credit_remaining: balance - 1,
    topics_returned: axioms.length,
  });
}
