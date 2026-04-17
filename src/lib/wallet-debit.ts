/**
 * #1152 Round 4 — Optional read-debit helper for Source APIs.
 *
 * Policy:
 *   - Unauthenticated reads stay FREE. Australian legislation is a public
 *     good; no debit happens when `x-source-agent-key` is absent. This also
 *     preserves the contract documented at /api/axiom/legislation/* and on
 *     the landing page.
 *   - When an authenticated agent supplies `x-source-agent-key`, we debit
 *     the agent's wallet by `amount` credits per read and write a
 *     `ledger_txs` row so the audit trail mirrors bounty distribution.
 *   - If the agent's balance goes to zero (or below), we return a 402
 *     Payment Required response the caller can short-circuit with.
 *
 * Usage:
 *   const debit = await debitIfAuthenticated(req, 1, "read.legislation");
 *   if (!debit.ok) return NextResponse.json(debit.body, { status: debit.status });
 *
 * The reason string identifies the metered surface for analytics; recommended
 * conventions are:
 *   - "read.legislation"   — /api/axiom/legislation/*
 *   - "read.scenario"      — /api/scenarios/*
 *   - "read.topic"         — /api/pact/topics/*
 *
 * This helper deliberately avoids the existing `authenticateAgent()` path
 * because it is read-only and scoped: we do not need the agent name, we only
 * need a valid agent id so we can debit the right wallet. Rate-limits /
 * reputation gates live elsewhere and should not be coupled here.
 */
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import { getDb } from "./db";

export type DebitResult =
  | { ok: true; agentId: string | null; debited: number }
  | { ok: false; status: 401 | 402 | 500; body: { error: string; code: string } };

const HEADER = "x-source-agent-key";

export async function debitIfAuthenticated(
  req: Request,
  amount: number,
  reason: string,
): Promise<DebitResult> {
  if (amount <= 0) return { ok: true, agentId: null, debited: 0 };

  const rawKey = req.headers.get(HEADER);
  if (!rawKey || rawKey.trim().length === 0) {
    // Anonymous / free-tier read — nothing to debit.
    return { ok: true, agentId: null, debited: 0 };
  }

  const db = await getDb();

  // The agents table stores the raw api_key today (see lib/auth.ts). We
  // support both the legacy raw column and a forward-compatible sha256 match
  // so this helper keeps working if api_key storage is hardened later.
  const hashed = createHash("sha256").update(rawKey).digest("hex");
  const agentResult = await db.execute({
    sql: "SELECT id FROM agents WHERE api_key = ? OR api_key = ?",
    args: [rawKey, hashed],
  });
  if (agentResult.rows.length === 0) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Invalid x-source-agent-key. Register via POST /api/pact/register.",
        code: "invalid_agent_key",
      },
    };
  }
  const agentId = agentResult.rows[0].id as string;

  // Debit only if there is balance. `>= amount` stops the ledger from going
  // negative even under concurrent requests.
  const updateResult = await db.execute({
    sql: "UPDATE agent_wallets SET balance = balance - ? WHERE agent_id = ? AND balance >= ?",
    args: [amount, agentId, amount],
  });

  if (updateResult.rowsAffected === 0) {
    // Either no wallet row or insufficient balance — fall through to a 402.
    return {
      ok: false,
      status: 402,
      body: {
        error:
          "Insufficient Source credits. Earn credits by contributing verified claims via /api/work/submit, or top up.",
        code: "insufficient_credits",
      },
    };
  }

  await db.execute({
    sql: "INSERT INTO ledger_txs (id, from_wallet, to_wallet, amount, topic_id, reason) VALUES (?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), agentId, "source-protocol", amount, null, reason],
  });

  return { ok: true, agentId, debited: amount };
}
