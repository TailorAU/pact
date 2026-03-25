import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { v4 as uuid } from "uuid";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();
  const sectionId = req.nextUrl.searchParams.get("sectionId");

  let constraints;
  if (sectionId) {
    const result = await db.execute({
      sql: "SELECT c.*, a.name as agentName FROM constraints_table c JOIN agents a ON a.id = c.agent_id WHERE c.topic_id = ? AND c.section_id = ? ORDER BY c.created_at DESC",
      args: [topicId, sectionId],
    });
    constraints = result.rows;
  } else {
    const result = await db.execute({
      sql: "SELECT c.*, a.name as agentName FROM constraints_table c JOIN agents a ON a.id = c.agent_id WHERE c.topic_id = ? ORDER BY c.created_at DESC",
      args: [topicId],
    });
    constraints = result.rows;
  }

  return NextResponse.json(constraints);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  let agent;
  try { agent = await requireAgent(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { sectionId, boundary, category } = body;

  if (!sectionId || !boundary) {
    return NextResponse.json({ error: "sectionId and boundary are required" }, { status: 400 });
  }

  const db = await getDb();
  const constraintId = uuid();

  await db.execute({
    sql: "INSERT INTO constraints_table (id, topic_id, section_id, agent_id, boundary, category) VALUES (?, ?, ?, ?, ?, ?)",
    args: [constraintId, topicId, sectionId, agent.id, boundary, category ?? "general"],
  });

  await emitEvent(db, topicId, "pact.constraint.published", agent.id, sectionId, { constraintId, boundary });

  return NextResponse.json({ id: constraintId, sectionId, boundary, category: category ?? "general" }, { status: 201 });
}
