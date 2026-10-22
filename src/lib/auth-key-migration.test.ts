/**
 * #5459 — Key hashing at rest with migrate-on-use.
 *
 * `resolveAgentByKey` (lib/auth.ts) is the single agent-key resolver:
 *   - hash-first lookup (new registrations store ONLY sha256 hex);
 *   - legacy plaintext rows still authenticate, and are upgraded in place
 *     to the hash on first successful use (one conditional UPDATE);
 *   - the hub-protocol 'system-no-key' sentinel is never a credential;
 *   - the stored hash itself is not a usable bearer key.
 *
 * Runs against a stateful in-memory DbClient — no Postgres.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import type { DbClient, DbResult } from "@/lib/db";
import { hashAgentKey, resolveAgentByKey } from "@/lib/auth";

type AgentRow = { id: string; name: string; api_key: string };

function makeDb(agents: AgentRow[]) {
  const rows = agents.map((a) => ({ ...a }));
  const updates: { sql: string; args: unknown[] }[] = [];
  const db: DbClient = {
    async execute(stmtOrSql): Promise<DbResult> {
      const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
      const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
      if (sql.includes("SELECT id, name FROM agents WHERE api_key = ?")) {
        const hit = rows.find((r) => r.api_key === args[0]);
        return { rows: hit ? [{ id: hit.id, name: hit.name }] : [] };
      }
      if (sql.includes("UPDATE agents SET api_key = ?")) {
        updates.push({ sql, args });
        const [next, id, expected] = args as [string, string, string];
        const hit = rows.find((r) => r.id === id && r.api_key === expected);
        if (!hit) return { rows: [], rowsAffected: 0 };
        hit.api_key = next;
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL in auth-key-migration test: ${sql}`);
    },
    async batch() {},
  };
  return { db, rows, updates };
}

describe("hashAgentKey (#5459)", () => {
  it("is the same sha256-hex shape as the commercial api_keys.secret_hash pattern", () => {
    const key = "pact_sk_abc123";
    expect(hashAgentKey(key)).toBe(createHash("sha256").update(key).digest("hex"));
    expect(hashAgentKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveAgentByKey — hash at rest + migrate-on-use (#5459)", () => {
  const PLAIN = "pact_sk_legacyplaintextkey000000000";

  it("accepts a legacy plaintext row and upgrades it in place with ONE update", async () => {
    const { db, rows, updates } = makeDb([{ id: "a1", name: "Legacy", api_key: PLAIN }]);

    const agent = await resolveAgentByKey(db, PLAIN);

    expect(agent).toEqual({ id: "a1", name: "Legacy" });
    expect(updates).toHaveLength(1);
    expect(rows[0].api_key).toBe(hashAgentKey(PLAIN)); // hash stored, plaintext gone
  });

  it("after migration the same plaintext resolves via the hash path with no further update", async () => {
    const { db, updates } = makeDb([{ id: "a1", name: "Legacy", api_key: PLAIN }]);

    await resolveAgentByKey(db, PLAIN); // migrates
    const again = await resolveAgentByKey(db, PLAIN);

    expect(again).toEqual({ id: "a1", name: "Legacy" });
    expect(updates).toHaveLength(1); // still exactly one
  });

  it("resolves a hashed-at-rest row (new registrations) without any update", async () => {
    const plain = "pact_sk_newlyminted0000000000000000";
    const { db, updates } = makeDb([{ id: "a2", name: "Fresh", api_key: hashAgentKey(plain) }]);

    const agent = await resolveAgentByKey(db, plain);

    expect(agent).toEqual({ id: "a2", name: "Fresh" });
    expect(updates).toHaveLength(0);
  });

  it("returns null for an unknown key", async () => {
    const { db } = makeDb([{ id: "a1", name: "Legacy", api_key: PLAIN }]);
    expect(await resolveAgentByKey(db, "pact_sk_wrong")).toBeNull();
  });

  it("the stored hash itself is not a usable bearer key", async () => {
    const plain = "pact_sk_newlyminted0000000000000000";
    const { db } = makeDb([{ id: "a2", name: "Fresh", api_key: hashAgentKey(plain) }]);
    expect(await resolveAgentByKey(db, hashAgentKey(plain))).toBeNull();
  });

  it("refuses the hub-protocol 'system-no-key' sentinel even though the row exists", async () => {
    const { db, updates } = makeDb([
      { id: "hub-protocol", name: "Hub Protocol", api_key: "system-no-key" },
    ]);
    expect(await resolveAgentByKey(db, "system-no-key")).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
