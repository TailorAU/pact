/**
 * tailor-group#63 — POST /api/pact/{topicId}/join-token must never act for an
 * agent that already exists.
 *
 * Defect: with a valid invite token and an existing agent's NAME alone, the
 * route (a) returned that agent's stored key when the row was a legacy
 * unmigrated plaintext `pact_sk_` key, and (b) for hashed and plaintext rows
 * alike ran the registration upsert, the invite-use bump and the
 * `pact.agent.joined` event under the existing agent's id — no proof of
 * possession of its key.
 *
 * The mock DbClient here implements `transaction()` with buffered writes: a
 * write is COMMITTED only when the transaction callback returns, and is
 * discarded when it throws. `committed` is therefore what a real database
 * would hold after the request. `emitEvent` is a spy so the event can be
 * asserted absent; the invite lookup, topic lookup and agent lookup are
 * answered from per-test state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DbClient, DbResult } from "@/lib/db";
import { hashAgentKey } from "@/lib/auth";

type ExecuteArg = string | { sql: string; args: unknown[] };
type Stmt = { sql: string; args: unknown[] };

const LEGACY_PLAINTEXT_KEY = "pact_sk_legacy0000synthetic0000000000"; // synthetic, never a real key
const HASHED_KEY = hashAgentKey("pact_sk_hashed0000synthetic0000000000"); // synthetic

const state = {
  /** Existing agent row the agent lookup returns (null = name is free). */
  existingAgent: null as null | { id: string; name: string; api_key: string },
  /** rowsAffected for the agent INSERT (0 simulates a concurrent create of the same name). */
  agentInsertAffected: 1,
  /** rowsAffected for the invite-use claim (0 simulates the last use redeemed concurrently). */
  inviteClaimAffected: 1,
  invite: { token: "invite-ok", topic_id: "topic-1", uses: 0, max_uses: 10 } as Record<string, unknown> | null,
};

/** Every statement the route issued (reads included). */
const issued: Stmt[] = [];
/** Writes that a real database would hold after the request. */
const committed: Stmt[] = [];

function isWrite(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
}

function answer(stmt: ExecuteArg): DbResult {
  const sql = typeof stmt === "string" ? stmt : stmt.sql;
  if (sql.includes("FROM invite_tokens")) return { rows: state.invite ? [state.invite] : [] };
  if (sql.includes("FROM topics")) return { rows: [{ id: "topic-1" }] };
  if (/FROM agents WHERE/i.test(sql)) {
    return { rows: state.existingAgent ? [state.existingAgent] : [] };
  }
  if (sql.startsWith("INSERT INTO agents")) return { rows: [], rowsAffected: state.agentInsertAffected };
  if (sql.startsWith("UPDATE invite_tokens")) return { rows: [], rowsAffected: state.inviteClaimAffected };
  return { rows: [], rowsAffected: 1 };
}

function norm(stmt: ExecuteArg): Stmt {
  return typeof stmt === "string" ? { sql: stmt, args: [] } : stmt;
}

const mockDb: DbClient = {
  execute: vi.fn(async (stmt: ExecuteArg) => {
    const s = norm(stmt);
    issued.push(s);
    if (isWrite(s.sql)) committed.push(s); // autocommit outside a transaction
    return answer(stmt);
  }),
  batch: vi.fn(async () => {}),
  transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => {
    const pending: Stmt[] = [];
    const tx: DbClient = {
      execute: async (stmt: ExecuteArg) => {
        const s = norm(stmt);
        issued.push(s);
        if (isWrite(s.sql)) pending.push(s);
        return answer(stmt);
      },
      batch: async () => {},
      inTransaction: true,
    };
    const result = await fn(tx); // a throw discards `pending` (ROLLBACK)
    committed.push(...pending);
    return result;
  },
};

const emitEventSpy = vi.fn(async () => {});

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: async () => mockDb,
    emitEvent: (...args: unknown[]) => (emitEventSpy as unknown as (...a: unknown[]) => Promise<void>)(...args),
  };
});

const rateLimitMock = vi.fn(async () => ({ allowed: true, remaining: 1, resetIn: 1 }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => (rateLimitMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  getRateLimitHeaders: () => ({}),
}));

import { POST } from "./route";

function joinToken(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/pact/topic-1/join-token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ topicId: "topic-1" }) }
  );
}

const writesTo = (table: string) => committed.filter((s) => s.sql.includes(table));
const issuedWrites = () => issued.filter((s) => isWrite(s.sql));

beforeEach(() => {
  issued.length = 0;
  committed.length = 0;
  emitEventSpy.mockClear();
  rateLimitMock.mockClear();
  state.existingAgent = null;
  state.agentInsertAffected = 1;
  state.inviteClaimAffected = 1;
  state.invite = { token: "invite-ok", topic_id: "topic-1", uses: 0, max_uses: 10 };
});

describe("POST /api/pact/{topicId}/join-token — an existing identity is refused before any mutation", () => {
  it("legacy plaintext row: no key returned, no registration, no invite use, no event", async () => {
    state.existingAgent = { id: "agent-legacy", name: "victim", api_key: LEGACY_PLAINTEXT_KEY };

    const res = await joinToken({ agentName: "victim", token: "invite-ok" });
    const text = await res.text();

    expect(res.status).toBe(409);
    expect(text).not.toContain(LEGACY_PLAINTEXT_KEY);
    expect(text).not.toContain("pact_sk_");
    const json = JSON.parse(text);
    expect(json.apiKey).toBeUndefined();
    expect(json.agentId).toBeUndefined();
    expect(json.error).toMatch(/already registered/);
    expect(json.error).toMatch(/\/api\/pact\/topic-1\/join/);

    // Not merely rolled back: the route never issued a write at all.
    expect(issuedWrites()).toEqual([]);
    expect(committed).toEqual([]);
    expect(emitEventSpy).not.toHaveBeenCalled();
  });

  it("hashed row: no key, no registration, no invite use, no event under the existing id", async () => {
    state.existingAgent = { id: "agent-hashed", name: "victim", api_key: HASHED_KEY };

    const res = await joinToken({ agentName: "victim", token: "invite-ok" });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.apiKey).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain(HASHED_KEY);
    expect(issuedWrites()).toEqual([]);
    expect(writesTo("registrations")).toEqual([]);
    expect(writesTo("invite_tokens")).toEqual([]);
    expect(emitEventSpy).not.toHaveBeenCalled();
    expect(issued.some((s) => s.args.includes("agent-hashed"))).toBe(false);
  });

  it("the lookup is case-insensitive (register's near-duplicate rule) and never selects the stored key", async () => {
    state.existingAgent = { id: "agent-hashed", name: "victim", api_key: HASHED_KEY };

    const res = await joinToken({ agentName: "VICTIM", token: "invite-ok" });

    expect(res.status).toBe(409);
    const lookup = issued.find((s) => /FROM agents WHERE/i.test(s.sql));
    expect(lookup?.sql).toMatch(/LOWER\(name\) = LOWER\(\?\)/);
    expect(lookup?.sql).not.toMatch(/api_key/);
    expect(issuedWrites()).toEqual([]);
  });

  it("an API key header does not turn join-token into an authenticated join for the existing agent", async () => {
    state.existingAgent = { id: "agent-hashed", name: "victim", api_key: HASHED_KEY };

    const res = await joinToken(
      { agentName: "victim", token: "invite-ok" },
      { "x-api-key": "pact_sk_hashed0000synthetic0000000000" }
    );

    expect(res.status).toBe(409);
    expect(issuedWrites()).toEqual([]);
    expect(emitEventSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/pact/{topicId}/join-token — new-agent creation", () => {
  it("mints a new agent atomically: agent, invite use, registration and event under the NEW id", async () => {
    const res = await joinToken({ agentName: "newcomer", token: "invite-ok" });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.apiKey).toMatch(/^pact_sk_[0-9a-f]{32}$/);
    expect(json.agentName).toBe("newcomer");
    expect(json.role).toBe("collaborator");

    const agentInsert = writesTo("INSERT INTO agents");
    expect(agentInsert).toHaveLength(1);
    expect(agentInsert[0].sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(agentInsert[0].args[0]).toBe(json.agentId);
    // Hash at rest (#5459): the plaintext is never persisted.
    expect(agentInsert[0].args[2]).toBe(hashAgentKey(json.apiKey));
    expect(agentInsert[0].args).not.toContain(json.apiKey);

    const claim = writesTo("UPDATE invite_tokens");
    expect(claim).toHaveLength(1);
    expect(claim[0].sql).toMatch(/uses < max_uses/);
    expect(claim[0].args).toEqual(["invite-ok", "topic-1"]);

    const reg = writesTo("INSERT INTO registrations");
    expect(reg).toHaveLength(1);
    expect(reg[0].args[2]).toBe(json.agentId);

    expect(emitEventSpy).toHaveBeenCalledTimes(1);
    expect(emitEventSpy.mock.calls[0]).toEqual(
      expect.arrayContaining(["topic-1", "pact.agent.joined", json.agentId])
    );
  });

  it("race: a same-name agent created between lookup and insert is never attached — 409, all writes rolled back", async () => {
    // Lookup sees no row; the concurrent request wins the insert.
    state.agentInsertAffected = 0;

    const res = await joinToken({ agentName: "contested", token: "invite-ok" });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.apiKey).toBeUndefined();
    expect(json.agentId).toBeUndefined();
    expect(committed).toEqual([]);
    // Nothing after the refused insert even ran.
    expect(issued.some((s) => s.sql.startsWith("INSERT INTO registrations"))).toBe(false);
    expect(issued.some((s) => s.sql.startsWith("UPDATE invite_tokens"))).toBe(false);
    expect(emitEventSpy).not.toHaveBeenCalled();
  });

  it("race: the invite's last use redeemed concurrently rolls the new agent back — 403, nothing committed", async () => {
    state.inviteClaimAffected = 0;

    const res = await joinToken({ agentName: "latecomer", token: "invite-ok" });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Invite token exhausted");
    expect(committed).toEqual([]);
    expect(emitEventSpy).not.toHaveBeenCalled();
  });

  it("still refuses an unknown invite (403) and an exhausted one (403) without writing", async () => {
    state.invite = null;
    expect((await joinToken({ agentName: "x-agent", token: "nope" })).status).toBe(403);
    state.invite = { token: "invite-ok", topic_id: "topic-1", uses: 10, max_uses: 10 };
    expect((await joinToken({ agentName: "x-agent", token: "invite-ok" })).status).toBe(403);
    expect(issuedWrites()).toEqual([]);
  });

  it("rejects a missing field and an unusable name with 400, and a flood with 429", async () => {
    expect((await joinToken({ token: "invite-ok" })).status).toBe(400);
    expect((await joinToken({ agentName: "<b></b>", token: "invite-ok" })).status).toBe(400);
    rateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, resetIn: 60 });
    expect((await joinToken({ agentName: "flood", token: "invite-ok" })).status).toBe(429);
    expect(issuedWrites()).toEqual([]);
  });
});
