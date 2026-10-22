/**
 * tailor-group#63 — the authenticated join is where an EXISTING agent goes
 * once join-token refuses its name. Pins that it still works for a caller
 * holding the agent's key, and refuses a caller without one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DbClient, DbResult } from "@/lib/db";

type ExecuteArg = string | { sql: string; args: unknown[] };
const executed: { sql: string; args: unknown[] }[] = [];

const mockDb = {
  execute: vi.fn(async (stmt: ExecuteArg): Promise<DbResult> => {
    const s = typeof stmt === "string" ? { sql: stmt, args: [] } : stmt;
    executed.push(s);
    if (s.sql.includes("FROM topics")) return { rows: [{ id: "topic-1", title: "T", status: "open" }] };
    return { rows: [], rowsAffected: 1 };
  }),
  batch: vi.fn(),
};

const emitEventSpy = vi.fn(async () => {});
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: async () => mockDb as unknown as DbClient,
    emitEvent: (...args: unknown[]) => (emitEventSpy as unknown as (...a: unknown[]) => Promise<void>)(...args),
  };
});

const requireAgentMock = vi.fn(async (): Promise<{ id: string; name: string }> => ({ id: "agent-7", name: "seven" }));
vi.mock("@/lib/auth", () => ({ requireAgent: () => requireAgentMock() }));
vi.mock("@/lib/write-limit", () => ({ enforceWriteLimit: async () => null }));

import { POST } from "./route";

function join() {
  return POST(
    new NextRequest("http://localhost/api/pact/topic-1/join", {
      method: "POST",
      headers: { "x-api-key": "pact_sk_synthetic00000000000000000000" },
    }),
    { params: Promise.resolve({ topicId: "topic-1" }) }
  );
}

beforeEach(() => {
  executed.length = 0;
  emitEventSpy.mockClear();
  requireAgentMock.mockClear();
});

describe("POST /api/pact/{topicId}/join — the existing agent's path", () => {
  it("joins the authenticated agent: registration + pact.agent.joined under its own id", async () => {
    const res = await join();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe("agent-7");
    expect(json).not.toHaveProperty("apiKey");
    const reg = executed.filter((s) => s.sql.includes("INSERT INTO registrations"));
    expect(reg).toHaveLength(1);
    expect(reg[0].args[2]).toBe("agent-7");
    expect(emitEventSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses a caller without a valid key (401) and writes nothing", async () => {
    requireAgentMock.mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await join();
    expect(res.status).toBe(401);
    expect(executed).toEqual([]);
    expect(emitEventSpy).not.toHaveBeenCalled();
  });
});
