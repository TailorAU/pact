import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { enforceWriteLimit } from "@/lib/write-limit";

// Open join — authenticated agents can join any open topic directly.
// No invite token required for public topics.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;

  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized. Register first: POST /api/pact/register" }, { status: 401 });
  }
  const limited = await enforceWriteLimit(agent.id);
  if (limited) return limited;

  const db = await getDb();

  const topicResult = await db.execute({ sql: "SELECT id, title, status FROM topics WHERE id = ?", args: [topicId] });
  const topic = topicResult.rows[0];

  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  // #5599 PR-A — mutating region in ONE transaction: the registration and
  // its §6.4 chain link commit together or not at all.
  await withTransaction(db, async (tx) => {
    // Register agent on topic (upsert)
    await tx.execute({
      sql: `INSERT INTO registrations (id, topic_id, agent_id, role)
      VALUES (?, ?, ?, 'collaborator')
      ON CONFLICT(topic_id, agent_id) DO UPDATE SET left_at = NULL, joined_at = NOW()`,
      args: [uuid(), topicId, agent.id],
    });

    await emitEvent(tx, topicId, "pact.agent.joined", agent.id, undefined, { agentName: agent.name });
  });

  return NextResponse.json({
    topicId,
    topicTitle: topic.title as string,
    agentId: agent.id,
    agentName: agent.name,
    role: "collaborator",
    message: "Joined topic. You can now propose, approve, and object.",
    hints: {
      doneEndpoint: `POST /api/pact/${topicId}/done`,
      assumptionsRequired: "When signaling 'aligned', you MUST include an 'assumptions' array. " +
        "Each entry: { title, tier } for new assumptions or { topicId } for existing ones. " +
        "Pass [] with 'noAssumptionsReason' (min 20 chars) if there are none.",
      canonicalize: "Submit a proposalType: 'canonicalize' proposal to set or refine the topic's canonical claim " +
        "(the exact statement being verified, distinct from the human-friendly title).",
      assumptionsEndpoint: `GET /api/pact/${topicId}/assumptions`,
      dependenciesEndpoint: `GET /api/pact/${topicId}/dependencies`,
    },
  });
}
