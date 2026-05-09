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
 *   - WS12 — per-agent daily spending cap (`agents.spending_cap_daily`).
 *     When set, the day's accumulated debits + this debit must remain
 *     below the cap, else the helper returns 402 with `cap_exceeded`.
 *     NULL cap means "no per-day cap"; balance is still the floor.
 *   - WS12 — burn alert. When the day's burn crosses 80% of the cap a
 *     warn-level structured log is emitted (`wallet.debit.burn_alert`).
 *     Routes to App Insights once the WS1 connection-string secret
 *     lands; until then it surfaces in `az containerapp logs show`.
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
import { log } from "./logger";

export type DebitResult =
  | { ok: true; agentId: string | null; debited: number }
  | {
      ok: false;
      status: 401 | 402 | 500;
      body: {
        error: string;
        code: string;
        capDaily?: number;
        debitedToday?: number;
      };
    };

const HEADER = "x-source-agent-key";

/** Burn-alert threshold. Emit a warn log when day's burn crosses this fraction. */
const BURN_ALERT_THRESHOLD = 0.8;

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
  // WS12: also pull spending_cap_daily so we can short-circuit before the
  // balance UPDATE if today's burn would exceed the cap.
  const hashed = createHash("sha256").update(rawKey).digest("hex");
  const agentResult = await db.execute({
    sql: "SELECT id, spending_cap_daily AS spendingCapDaily FROM agents WHERE api_key = ? OR api_key = ?",
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
  const agentRow = agentResult.rows[0];
  const agentId = agentRow.id as string;
  const capDailyRaw = agentRow.spendingCapDaily;
  const capDaily =
    typeof capDailyRaw === "number"
      ? capDailyRaw
      : typeof capDailyRaw === "string" && capDailyRaw.length > 0
        ? Number(capDailyRaw)
        : null;

  // WS12 — daily cap enforcement. Best-effort: a query failure here MUST NOT
  // strand the user response. We log + continue on error; the existing
  // balance check below still acts as the ultimate floor on spend.
  if (capDaily !== null && Number.isFinite(capDaily) && capDaily >= 0) {
    let debitedToday = 0;
    try {
      const sumResult = await db.execute({
        sql: `SELECT COALESCE(SUM(amount), 0) AS sumToday
                FROM ledger_txs
               WHERE from_wallet = ?
                 AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        args: [agentId],
      });
      const sumRaw = sumResult.rows[0]?.sumToday;
      debitedToday =
        typeof sumRaw === "number"
          ? sumRaw
          : typeof sumRaw === "string" && sumRaw.length > 0
            ? Number(sumRaw)
            : 0;
      if (!Number.isFinite(debitedToday)) debitedToday = 0;
    } catch (err) {
      log.error(
        { err, op: "wallet.debit.cap_check_failed", agentId },
        "spending-cap query failed; falling through to balance check",
      );
    }

    if (debitedToday + amount > capDaily) {
      return {
        ok: false,
        status: 402,
        body: {
          error:
            "Daily spending cap exceeded for this agent key. Raise spending_cap_daily or wait for the UTC-day rollover.",
          code: "cap_exceeded",
          capDaily,
          debitedToday,
        },
      };
    }

    // Burn alert — fires when post-debit burn ≥ 80% of cap. Best-effort log
    // only: failures here cannot break the user response (the logger itself
    // is a stdout write — it does not throw).
    const projected = debitedToday + amount;
    if (capDaily > 0 && projected >= BURN_ALERT_THRESHOLD * capDaily) {
      const actorKeyHash = createHash("sha256").update(rawKey).digest("hex");
      log.warn(
        {
          op: "wallet.debit.burn_alert",
          agentId,
          actorKeyHash,
          capDaily,
          debitedToday: projected,
          percentBurned: capDaily > 0 ? projected / capDaily : null,
          reason,
        },
        "agent daily-spend approaching or exceeding burn threshold",
      );
    }
  }

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
