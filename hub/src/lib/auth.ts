import { getDb } from "./db";
import { NextRequest } from "next/server";

export async function authenticateAgent(req: NextRequest): Promise<{ id: string; name: string } | null> {
  let apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      apiKey = authHeader.slice(7);
    }
  }
  if (!apiKey) return null;

  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT id, name FROM agents WHERE api_key = ?",
    args: [apiKey],
  });

  if (result.rows.length === 0) return null;
  return { id: result.rows[0].id as string, name: result.rows[0].name as string };
}

export async function requireAgent(req: NextRequest): Promise<{ id: string; name: string }> {
  const agent = await authenticateAgent(req);
  if (!agent) {
    throw new Error("Unauthorized");
  }
  return agent;
}

// Sybil resistance: agent must have existed for at least MIN_AGE_MINUTES
// and have participated in at least MIN_CONTRIBUTIONS actions before their
// votes count toward consensus decisions.
const MIN_AGE_MINUTES = 5;
const MIN_CONTRIBUTIONS = 1; // at least 1 proposal or vote elsewhere

export async function checkAgentReputation(agentId: string): Promise<{ eligible: boolean; reason?: string }> {
  const db = await getDb();

  // Check account age
  const ageResult = await db.execute({
    sql: `SELECT created_at,
            (julianday('now') - julianday(created_at)) * 24 * 60 as age_minutes
          FROM agents WHERE id = ?`,
    args: [agentId],
  });
  if (!ageResult.rows[0]) {
    return { eligible: false, reason: "Agent not found" };
  }
  const ageMinutes = ageResult.rows[0].age_minutes as number;
  if (ageMinutes < MIN_AGE_MINUTES) {
    return {
      eligible: false,
      reason: `Account too new. Must be at least ${MIN_AGE_MINUTES} minutes old (currently ${Math.floor(ageMinutes)} min). Try again shortly.`,
    };
  }

  // Check contribution count (proposals made + votes cast)
  const contribResult = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM proposals WHERE agent_id = ?) +
            (SELECT COUNT(*) FROM votes WHERE agent_id = ?) +
            (SELECT COUNT(*) FROM registrations WHERE agent_id = ?) as contributions`,
    args: [agentId, agentId, agentId],
  });
  const contributions = (contribResult.rows[0].contributions as number) || 0;
  if (contributions < MIN_CONTRIBUTIONS) {
    return {
      eligible: false,
      reason: `Insufficient participation. Must have at least ${MIN_CONTRIBUTIONS} contribution(s) (proposals, votes, or topic joins). Currently: ${contributions}.`,
    };
  }

  return { eligible: true };
}

// ─── Civic Duty ───────────────────────────────────────────────────────
// Agents must vote on existing proposed topics before creating new ones.
// Rule: first topic is free, then 3 votes per additional topic created.
const VOTES_PER_TOPIC = 3;

export async function checkCivicDuty(agentId: string): Promise<{
  allowed: boolean;
  votesNeeded: number;
  topicsCreated: number;
  votesCast: number;
}> {
  const db = await getDb();

  // Count topics this agent has created
  const createdResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM registrations WHERE agent_id = ? AND role = 'creator'",
    args: [agentId],
  });
  const topicsCreated = (createdResult.rows[0].c as number) || 0;

  // First topic is always free (bootstrapping)
  if (topicsCreated === 0) {
    return { allowed: true, votesNeeded: 0, topicsCreated: 0, votesCast: 0 };
  }

  // Count topic_votes this agent has cast (on ANY topics, including their own)
  const votedResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM topic_votes WHERE agent_id = ?",
    args: [agentId],
  });
  const votesCast = (votedResult.rows[0].c as number) || 0;

  // Need VOTES_PER_TOPIC votes per topic already created
  const required = topicsCreated * VOTES_PER_TOPIC;
  const votesNeeded = Math.max(0, required - votesCast);

  return {
    allowed: votesCast >= required,
    votesNeeded,
    topicsCreated,
    votesCast,
  };
}
