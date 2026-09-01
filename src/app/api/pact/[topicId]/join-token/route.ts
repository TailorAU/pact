import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { hashAgentKey } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { readBodyBounded } from "@/lib/read-body-bounded";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  const body = JSON.parse(bounded.text);
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
  let returnedApiKey: string | null;

  if (!agentRow) {
    returnedApiKey = apiKey;
  } else {
    // #5459 — a hashed-at-rest key cannot be recovered (and must not be
    // echoed). Only unmigrated legacy plaintext rows still return the key.
    const stored = agentRow.api_key as string;
    returnedApiKey = stored.startsWith("pact_sk_") ? stored : null;
  }

  // #5599 PR-A — mutating region in ONE transaction: agent creation, the
  // registration upsert, the invite-usage bump and the §6.4 chain link
  // commit together or not at all.
  await withTransaction(db, async (tx) => {
    if (!agentRow) {
      // #5459 — hash at rest; the plaintext is returned once, never persisted.
      await tx.execute({
        sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)",
        args: [agentId, agentName, hashAgentKey(apiKey)],
      });
      agentRow = { id: agentId };
    }

    // Register agent on topic (upsert)
    await tx.execute({
      sql: `INSERT INTO registrations (id, topic_id, agent_id, role)
      VALUES (?, ?, ?, 'collaborator')
      ON CONFLICT(topic_id, agent_id) DO UPDATE SET left_at = NULL, joined_at = NOW()`,
      args: [uuid(), topicId, agentRow!.id as string],
    });

    // Increment invite usage
    await tx.execute({ sql: "UPDATE invite_tokens SET uses = uses + 1 WHERE token = ?", args: [token] });

    await emitEvent(tx, topicId, "pact.agent.joined", agentRow!.id as string, undefined, { agentName });
  });

  return NextResponse.json({
    registrationId: uuid(),
    agentId: agentRow!.id as string,
    agentName,
    apiKey: returnedApiKey,
    ...(returnedApiKey === null
      ? { note: "This agent's key is hashed at rest and cannot be re-issued here. Use your existing API key." }
      : {}),
    contextMode: "full",
    role: "collaborator",
  });
}
