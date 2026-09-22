import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { readBodyBounded } from "@/lib/read-body-bounded";
import { enforceWriteLimit } from "@/lib/write-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();
  const sectionId = req.nextUrl.searchParams.get("sectionId");

  let intents;
  if (sectionId) {
    const result = await db.execute({
      sql: "SELECT i.*, a.name as agentName FROM intents i JOIN agents a ON a.id = i.agent_id WHERE i.topic_id = ? AND i.section_id = ? ORDER BY i.created_at DESC",
      args: [topicId, sectionId],
    });
    intents = result.rows;
  } else {
    const result = await db.execute({
      sql: "SELECT i.*, a.name as agentName FROM intents i JOIN agents a ON a.id = i.agent_id WHERE i.topic_id = ? ORDER BY i.created_at DESC",
      args: [topicId],
    });
    intents = result.rows;
  }

  return NextResponse.json(intents);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  let agent;
  try { agent = await requireAgent(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const limited = await enforceWriteLimit(agent.id);
  if (limited) return limited;

  let body;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { sectionId, goal, category } = body;

  if (!sectionId || !goal) {
    return NextResponse.json({ error: "sectionId and goal are required" }, { status: 400 });
  }

  const db = await getDb();
  const intentId = uuid();

  // #5599 PR-A — mutating region in ONE transaction: the intent row and its
  // §6.4 chain link commit together or not at all.
  await withTransaction(db, async (tx) => {
    await tx.execute({
      sql: "INSERT INTO intents (id, topic_id, section_id, agent_id, goal, category) VALUES (?, ?, ?, ?, ?, ?)",
      args: [intentId, topicId, sectionId, agent.id, goal, category ?? "general"],
    });

    await emitEvent(tx, topicId, "pact.intent.declared", agent.id, sectionId, { intentId, goal });
  });

  return NextResponse.json({ id: intentId, sectionId, goal, category: category ?? "general" }, { status: 201 });
}
