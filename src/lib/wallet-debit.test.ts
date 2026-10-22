/**
 * WS12 — Spending-cap regression tests for debitIfAuthenticated.
 *
 * Locks in:
 *   1. NULL spending_cap_daily → debit succeeds (cap query is skipped or
 *      ignored; existing balance-check semantics preserved).
 *   2. Under-cap debit → succeeds; ledger_txs row written.
 *   3. At-cap-or-over debit → 402 with { error, code: "cap_exceeded",
 *      capDaily, debitedToday }; balance UPDATE NOT executed.
 *   4. Burn alert: when post-debit burn ≥ 80% of cap, a warn-level
 *      `wallet.debit.burn_alert` is emitted on stderr.
 *   5. Cap-query failure is best-effort: if the SUM query throws, the
 *      helper still proceeds to the balance check (it does not 500).
 *   6. Anonymous / no-key → no DB hit, returns ok with debited=0.
 *
 * Mocks the DB module so the suite is hermetic and deterministic. The
 * structured logger writes JSON lines to stderr; the suite spies on
 * process.stderr.write to assert the burn-alert payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "./db";

type MockDb = {
  execute: ReturnType<
    typeof vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>
  >;
  batch: ReturnType<typeof vi.fn>;
};

const mockDb: MockDb = {
  execute: vi.fn(),
  batch: vi.fn(),
};

vi.mock("./db", () => ({
  getDb: async () => mockDb as unknown as DbClient,
}));

let stderrWrites: string[];
let stderrSpy: ReturnType<typeof vi.spyOn>;

function makeRequestWithKey(key: string | null): Request {
  const headers = new Headers();
  if (key !== null) headers.set("x-source-agent-key", key);
  return new Request("https://example.test/api/test", { headers });
}

function findExecuteCallContaining(needle: string): { sql: string; args: unknown[] } | undefined {
  const call = mockDb.execute.mock.calls.find((c) => {
    const arg = c[0];
    if (typeof arg === "object" && arg !== null && "sql" in arg) {
      return typeof arg.sql === "string" && arg.sql.includes(needle);
    }
    return false;
  });
  return call?.[0] as { sql: string; args: unknown[] } | undefined;
}

function findBurnAlertLog(): Record<string, unknown> | undefined {
  for (const line of stderrWrites) {
    for (const json of line.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(json);
        if (parsed.op === "wallet.debit.burn_alert") return parsed;
      } catch {
        // not JSON — skip
      }
    }
  }
  return undefined;
}

beforeEach(() => {
  mockDb.execute.mockReset();
  stderrWrites = [];
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrWrites.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe("debitIfAuthenticated — anonymous / no-key", () => {
  it("returns ok with debited=0 when no key header is present", async () => {
    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey(null), 1, "read.test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBeNull();
      expect(result.debited).toBe(0);
    }
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("returns ok with debited=0 when amount is zero", async () => {
    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("any"), 0, "read.test");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.debited).toBe(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

describe("debitIfAuthenticated — spending cap (WS12)", () => {
  it("succeeds when spending_cap_daily is NULL (no cap configured)", async () => {
    // 1) agent lookup → spendingCapDaily NULL
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-1", spendingCapDaily: null }],
      rowsAffected: 1,
    });
    // 2) UPDATE agent_wallets — balance debit succeeds
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    // 3) INSERT ledger_txs
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBe("agent-1");
      expect(result.debited).toBe(1);
    }

    // SUM ledger_txs query MUST NOT have been issued (NULL cap → skip)
    expect(findExecuteCallContaining("SELECT COALESCE(SUM(amount)")).toBeUndefined();
    // INSERT ledger_txs MUST have been issued
    expect(findExecuteCallContaining("INSERT INTO ledger_txs")).toBeDefined();
    expect(findBurnAlertLog()).toBeUndefined();
  });

  it("succeeds when (debitedToday + amount) <= cap", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-2", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // SUM(amount) for today = 50 → 50 + 1 = 51 ≤ 100 → proceed
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ sumToday: 50 }],
      rowsAffected: 1,
    });
    // UPDATE balance + INSERT ledger
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(true);
    expect(findExecuteCallContaining("SELECT COALESCE(SUM(amount)")).toBeDefined();
    expect(findExecuteCallContaining("INSERT INTO ledger_txs")).toBeDefined();
    // 51 / 100 = 51% → no burn alert
    expect(findBurnAlertLog()).toBeUndefined();
  });

  it("returns 402 cap_exceeded when (debitedToday + amount) > cap", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-3", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // 105 + 1 = 106 > 100 → 402
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ sumToday: 105 }],
      rowsAffected: 1,
    });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.body.code).toBe("cap_exceeded");
      expect(result.body.capDaily).toBe(100);
      expect(result.body.debitedToday).toBe(105);
    }

    // The balance UPDATE MUST NOT have been issued — cap blocks before debit.
    expect(findExecuteCallContaining("UPDATE agent_wallets")).toBeUndefined();
    expect(findExecuteCallContaining("INSERT INTO ledger_txs")).toBeUndefined();
  });

  it("returns 402 cap_exceeded when at exactly cap with non-zero amount", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-4", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // 100 + 1 = 101 > 100 → 402 (the cap is inclusive: at-cap exactly is fine,
    // exceeding by ≥1 is not).
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ sumToday: 100 }],
      rowsAffected: 1,
    });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe("cap_exceeded");
      expect(result.body.debitedToday).toBe(100);
    }
  });

  it("emits a burn-alert warn log when post-debit burn ≥ 80% of cap", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-5", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // 79 + 1 = 80 → 80% → triggers alert; cap not exceeded
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ sumToday: 79 }],
      rowsAffected: 1,
    });
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(true);
    const alert = findBurnAlertLog();
    expect(alert).toBeDefined();
    expect(alert!.agentId).toBe("agent-5");
    expect(alert!.capDaily).toBe(100);
    expect(alert!.debitedToday).toBe(80);
    expect(alert!.percentBurned).toBeCloseTo(0.8, 5);
    expect(alert!.reason).toBe("read.legislation");
    expect(alert!.actorKeyHash).toEqual(expect.any(String));
    // Hash, not raw key
    expect(alert!.actorKeyHash).not.toBe("k");
  });

  it("does NOT emit a burn-alert when burn is well below threshold", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-6", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // 1 + 1 = 2 → 2% → no alert
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ sumToday: 1 }],
      rowsAffected: 1,
    });
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(findBurnAlertLog()).toBeUndefined();
  });

  it("falls through to balance check when the cap-SUM query throws (best-effort)", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-7", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // SUM throws → must NOT 500. Falls through to balance UPDATE.
    mockDb.execute.mockRejectedValueOnce(new Error("boom"));
    // UPDATE balance succeeds
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
    // INSERT ledger
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(true);
    expect(findExecuteCallContaining("UPDATE agent_wallets")).toBeDefined();
  });

  it("treats string-encoded numerics from pg (e.g. SUM bigint) as numbers", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "agent-8", spendingCapDaily: 100 }],
      rowsAffected: 1,
    });
    // pg returns SUM(integer) as a string when type-cast; ensure helper coerces.
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ sumToday: "105" }],
      rowsAffected: 1,
    });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("k"), 1, "read.legislation");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe("cap_exceeded");
      expect(result.body.debitedToday).toBe(105);
    }
  });
});

describe("debitIfAuthenticated — invalid key", () => {
  it("returns 401 invalid_agent_key when no agent matches", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });

    const { debitIfAuthenticated } = await import("./wallet-debit");
    const result = await debitIfAuthenticated(makeRequestWithKey("bogus"), 1, "read.legislation");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.body.code).toBe("invalid_agent_key");
    }
  });
});
