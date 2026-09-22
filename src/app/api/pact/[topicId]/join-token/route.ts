import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { hashAgentKey } from "@/lib/auth";
import { v4 as uuid } from "uuid";
import { readBodyBounded } from "@/lib/read-body-bounded";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { sanitizeAgentName } from "@/lib/sanitize";

/**
 * POST /api/pact/{topicId}/join-token — anonymous join by invite token.
 *
 * Contract (tailor-group#63): this route MINTS a new agent identity and
 * joins it to the topic. It never acts for an agent that already exists.
 * An invite token plus a name is not proof of possession of that agent's
 * key, so a name that is already registered is refused with 409 before any
 * mutation — no key is returned (legacy plaintext or hashed), no
 * registration is written, the invite is not consumed and no
 * `pact.agent.joined` event is emitted. An existing agent joins with its own
 * key at POST /api/pact/{topicId}/join.
 */

const NAME_TAKEN_ERROR = (name: string, topicId: string) =>
  `Agent name "${name}" is already registered. An invite token cannot act for an existing agent. ` +
  `Authenticate as that agent (X-Api-Key or Authorization: Bearer) and join with POST /api/pact/${topicId}/join, ` +
  "or choose a different name to mint a new agent here.";

/** Thrown inside the transaction to roll it back and answer with `status`. */
class JoinRefusal extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error));
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;

  // This route can mint an agent identity (invite-token path), so it shares
  // the registration flood backstop; the invite's max_uses is the real cap.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
  const rl = await rateLimit(ip, "register-ip");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registrations from this address. Try again later." },
      { status: 429, headers: getRateLimitHeaders(rl) }
    );
  }

  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  let body;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { agentName, token } = body ?? {};

  if (!agentName || !token || typeof token !== "string") {
    return NextResponse.json({ error: "agentName and token are required" }, { status: 400 });
  }

  // Same name policy as POST /api/pact/register.
  const nameResult = sanitizeAgentName(agentName);
  if (!nameResult.valid) {
    return NextResponse.json({ error: nameResult.error }, { status: 400 });
  }
  const cleanName = nameResult.sanitized;

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

  // tailor-group#63 — an existing identity is refused BEFORE the transaction.
  // Case-insensitive, matching register's near-duplicate rule. Only the id is
  // read: the stored key (hashed or legacy plaintext) is never selected here.
  const existing = await db.execute({
    sql: "SELECT id FROM agents WHERE LOWER(name) = LOWER(?)",
    args: [cleanName],
  });
  if (existing.rows[0]) {
    return NextResponse.json({ error: NAME_TAKEN_ERROR(cleanName, topicId) }, { status: 409 });
  }

  const apiKey = `pact_sk_${uuid().replace(/-/g, "")}`;
  const agentId = uuid();

  // #5599 PR-A — mutating region in ONE transaction: agent creation, the
  // registration upsert, the invite-usage bump and the §6.4 chain link
  // commit together or not at all.
  try {
    await withTransaction(db, async (tx) => {
      // Insert-if-absent. A concurrent request that created the same name
      // between the lookup and here makes this a no-op (rowsAffected 0); the
      // route then refuses and rolls back. It never falls through to the
      // concurrently created row. #5459 — hash at rest; the plaintext is
      // returned once below, never persisted.
      const inserted = await tx.execute({
        sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        args: [agentId, cleanName, hashAgentKey(apiKey)],
      });
      if ((inserted.rowsAffected ?? 0) !== 1) {
        throw new JoinRefusal(409, { error: NAME_TAKEN_ERROR(cleanName, topicId) });
      }

      // Claim one invite use atomically; a concurrent redemption of the last
      // use makes this a no-op and the whole join rolls back.
      const claimed = await tx.execute({
        sql: "UPDATE invite_tokens SET uses = uses + 1 WHERE token = ? AND topic_id = ? AND uses < max_uses",
        args: [token, topicId],
      });
      if ((claimed.rowsAffected ?? 0) !== 1) {
        throw new JoinRefusal(403, { error: "Invite token exhausted" });
      }

      // Register agent on topic (upsert)
      await tx.execute({
        sql: `INSERT INTO registrations (id, topic_id, agent_id, role)
        VALUES (?, ?, ?, 'collaborator')
        ON CONFLICT(topic_id, agent_id) DO UPDATE SET left_at = NULL, joined_at = NOW()`,
        args: [uuid(), topicId, agentId],
      });

      await emitEvent(tx, topicId, "pact.agent.joined", agentId, undefined, { agentName: cleanName });
    });
  } catch (e) {
    if (e instanceof JoinRefusal) {
      return NextResponse.json(e.body, { status: e.status });
    }
    throw e;
  }

  return NextResponse.json({
    registrationId: uuid(),
    agentId,
    agentName: cleanName,
    apiKey,
    contextMode: "full",
    role: "collaborator",
  });
}
