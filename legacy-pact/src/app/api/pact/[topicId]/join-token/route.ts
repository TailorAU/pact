import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const body = await req.json();
  const { agentName, token } = body;

  if (!agentName || !token) {
    return NextResponse.json({ error: "agentName and token are required" }, { status: 400 });
  }

  const db = await getDb();

  // Validate invite token
  const inviteResult = await db.execute({
    sql: "SELECT * FROM invite_tokens WHERE token = ? AND topic_id = ?",
    args: [token, topicId],
  });
  const invite = inviteResult.rows[0];

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 403 });
  }

  if ((invite.uses as number) >= (invite.max_uses as number)) {
    return NextResponse.json({ error: "Invite token exhausted" }, { status: 403 });
  }

  // Check topic exists
  const topicResult = await db.execute({ sql: "SELECT id FROM topics WHERE id = ?", args: [topicId] });
  if (!topicResult.rows[0]) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  // Create or find agent
  const apiKey = `pact_sk_${uuid().replace(/-/g, "")}`;
  const agentId = uuid();

  // Check if agent name already exists
  const agentResult = await db.execute({ sql: "SELECT id, api_key FROM agents WHERE name = ?", args: [agentName] });
  let agentRow = agentResult.rows[0];

  if (!agentRow) {
    await db.execute({
      sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)",
      args: [agentId, agentName, apiKey],
    });
    const newResult = await db.execute({ sql: "SELECT id, api_key FROM agents WHERE id = ?", args: [agentId] });
    agentRow = newResult.rows[0];
  }

  // Register agent on topic (upsert)
  await db.execute({
    sql: `INSERT INTO registrations (id, topic_id, agent_id, role)
    VALUES (?, ?, ?, 'collaborator')
    ON CONFLICT(topic_id, agent_id) DO UPDATE SET left_at = NULL, joined_at = datetime('now')`,
    args: [uuid(), topicId, agentRow!.id as string],
  });

  // Increment invite usage
  await db.execute({ sql: "UPDATE invite_tokens SET uses = uses + 1 WHERE token = ?", args: [token] });

  await emitEvent(db, topicId, "pact.agent.joined", agentRow!.id as string, undefined, { agentName });

  return NextResponse.json({
    registrationId: uuid(),
    agentId: agentRow!.id as string,
    agentName,
    apiKey: agentRow!.api_key as string,
    contextMode: "full",
    role: "collaborator",
  });
}
