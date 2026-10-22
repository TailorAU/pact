/**
 * tailor-group#7 — POST /api/pact/register: open registration behind a
 * proof-of-work cost instead of a 3/hour-per-IP quota.
 *
 *   1. No `pow` → 428 with a challenge (no DB touched).
 *   2. Valid `pow` → 201 with an apiKey; the challenge is then spent.
 *   3. Bad `pow` → 428 with reason + fresh challenge.
 *   4. The per-IP flood backstop still 429s (mocked limiter).
 *   5. REGISTRATION_POW=off skips the gate (local dev only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DbClient, DbResult } from "@/lib/db";

type ExecuteArg = string | { sql: string; args: unknown[] };
const executed: { sql: string; args: unknown[] }[] = [];

const mockDb = {
  execute: vi.fn<(stmt: ExecuteArg) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  getDb: async () => mockDb as unknown as DbClient,
}));

vi.mock("@/lib/redis-client", () => ({
  getRedis: async () => null,
}));

const rateLimitMock = vi.fn(async () => ({ allowed: true, remaining: 1, resetIn: 1 }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => (rateLimitMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  getRateLimitHeaders: () => ({}),
}));

import { POST } from "./route";
import { solveChallenge, __resetPowForTests } from "@/lib/registration-pow";

const originalEnv = { ...process.env };

function post(body: unknown, ip = "198.51.100.7") {
  return POST(
    new NextRequest("http://localhost/api/pact/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  __resetPowForTests();
  process.env.REGISTRATION_POW_BITS = "10";
  process.env.REGISTRATION_POW_SECRET = "route-test";
  delete process.env.REGISTRATION_POW;
  executed.length = 0;
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, resetIn: 1 });
  mockDb.execute.mockReset();
  mockDb.execute.mockImplementation(async (stmt: ExecuteArg) => {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const args = typeof stmt === "string" ? [] : stmt.args;
    executed.push({ sql, args });
    if (sql.includes("COUNT(*) as c FROM agents")) return { rows: [{ c: "3" }], rowsAffected: 0 };
    if (sql.includes("WHERE LOWER(name) = LOWER(?)")) return { rows: [], rowsAffected: 0 };
    return { rows: [], rowsAffected: 1 };
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/pact/register", () => {
  it("answers 428 with a challenge when pow is absent, without touching the DB", async () => {
    const res = await post({ agentName: "alpha" });
    expect(res.status).toBe(428);
    const json = await res.json();
    expect(json.pow.challenge).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(json.pow.bits).toBe(10);
    expect(json.pow.algorithm).toBe("sha256-leading-zero-bits");
    expect(executed).toHaveLength(0);
  });

  it("registers with a valid solution and spends the challenge", async () => {
    const first = await (await post({ agentName: "beta" })).json();
    const nonce = solveChallenge(first.pow.challenge, first.pow.bits);

    const res = await post({ agentName: "beta", pow: { challenge: first.pow.challenge, nonce } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.apiKey).toMatch(/^pact_sk_/);
    expect(json.agentName).toBe("beta");
    expect(executed.some((e) => e.sql.startsWith("INSERT INTO agents"))).toBe(true);

    // replay of the same solution is refused
    const replay = await post({ agentName: "beta2", pow: { challenge: first.pow.challenge, nonce } });
    expect(replay.status).toBe(428);
    expect((await replay.json()).error).toMatch(/already used/);
  });

  it("answers 428 with the reason and a fresh challenge on a wrong nonce", async () => {
    const first = await (await post({ agentName: "gamma" })).json();
    const res = await post({ agentName: "gamma", pow: { challenge: first.pow.challenge, nonce: "not-a-solution-zzzz" } });
    expect(res.status).toBe(428);
    const json = await res.json();
    expect(json.error).toMatch(/difficulty/);
    expect(json.pow.challenge).not.toBe(first.pow.challenge);
    expect(executed.some((e) => e.sql.startsWith("INSERT"))).toBe(false);
  });

  it("still 429s when the per-IP flood backstop trips", async () => {
    rateLimitMock.mockImplementation(async (...args: unknown[]) => {
      const name = args[1];
      return name === "register-ip"
        ? { allowed: false, remaining: 0, resetIn: 60 }
        : { allowed: true, remaining: 1, resetIn: 1 };
    });
    const res = await post({ agentName: "delta" });
    expect(res.status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith("198.51.100.7", "register-ip");
  });

  it("uses the register-ip backstop, never the retired 3/hour `register` window", async () => {
    await post({ agentName: "epsilon" });
    const names = rateLimitMock.mock.calls.map((c) => (c as unknown[])[1]);
    expect(names).toContain("register-ip");
    expect(names).not.toContain("register");
  });

  it("enforces the daily circuit breaker (env-tunable)", async () => {
    process.env.MAX_DAILY_REGISTRATIONS = "3";
    const first = await (await post({ agentName: "zeta" })).json();
    const nonce = solveChallenge(first.pow.challenge, first.pow.bits);
    const res = await post({ agentName: "zeta", pow: { challenge: first.pow.challenge, nonce } });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Daily registration limit/);
  });

  it("skips the gate when REGISTRATION_POW=off", async () => {
    process.env.REGISTRATION_POW = "off";
    const res = await post({ agentName: "eta" });
    expect(res.status).toBe(201);
  });
});
