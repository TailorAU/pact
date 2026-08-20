/**
 * #5277 — Regression tests for POST /api/pact/{topicId}/vote quorum transition.
 *
 * Defect (refs pact#56): a legislation proposal reaching its 3rd approval via
 * the vote route was flipped straight to status='open', but the legislation
 * auto-ingest branch lived only in evaluateTopicProposals (the sweep), which
 * scans status='proposed' — so quorum-by-vote NEVER ingested the legislation.
 *
 * These tests run the REAL `finalizeApprovedTopic` / `emitEvent` from
 * `@/lib/db` (only `getDb` is mocked) so the route's threshold branch is
 * proven to exercise the same ingest path the sweep uses:
 *   1. 3rd approval on a "[Legislation Proposal]" topic → ingestDocuments
 *      fires, topic → 'consensus', `pact.legislation.ingested` emitted.
 *   2. 3rd approval on a non-legislation topic → topic → 'open',
 *      `pact.topic.approved` emitted, NO ingest.
 *   3. Below-quorum approval → no status change, NO ingest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

type ExecuteArg = string | { sql: string; args: unknown[] };

const executedStatements: { sql: string; args: unknown[] }[] = [];

const mockDb = {
  execute: vi.fn<(stmt: ExecuteArg) => Promise<DbResult>>(),
  batch: vi.fn(),
};

// Partial mock: keep the REAL finalizeApprovedTopic + emitEvent (the code
// under test), replace only the connection factory.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: async () => mockDb as unknown as DbClient,
  };
});

vi.mock("@/lib/auth", () => ({
  requireAgent: vi.fn(async () => ({ id: "agent-1", name: "Verifier One" })),
  checkAgentReputation: vi.fn(async () => ({ eligible: true })),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
  getRateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => {}),
  ipCountryFromHeaders: vi.fn(() => null),
}));

const ingestDocuments = vi.fn(async () => ({ ingested: 1, sectionsTotal: 3 }));
vi.mock("@/lib/legislation-sync", () => ({
  ingestDocuments: (...args: unknown[]) =>
    (ingestDocuments as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

import { POST } from "./route";

const LEGISLATION_TOPIC_ID = "b929b87e-01ca-4ead-b520-3e7d674f0507";
const PLAIN_TOPIC_ID = "11111111-2222-3333-4444-555555555555";

const legislationPayload = {
  proposedBy: "agent-0",
  document: {
    id: "qld/report-2026-moonside",
    title: "Moonside Report 2026",
    sections: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
  },
};

function topicRow(id: string, title: string) {
  return { id, title, status: "proposed", tier: "institutional" };
}

/**
 * SQL-shape-dispatching db mock: responds by statement content (not call
 * order) so the real finalizeApprovedTopic / emitEvent can interleave their
 * own statements freely. Every statement is recorded for assertions.
 */
function armDb(opts: { topic: { id: string; title: string }; approveCount: number }) {
  mockDb.execute.mockImplementation(async (stmt: ExecuteArg) => {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const args = typeof stmt === "string" ? [] : stmt.args;
    executedStatements.push({ sql, args });

    if (sql.includes("FROM topics WHERE id = ?")) {
      return { rows: [topicRow(opts.topic.id, opts.topic.title)] };
    }
    if (sql.startsWith("INSERT INTO topic_votes")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT COUNT(*) as c FROM topic_votes")) {
      return { rows: [{ c: opts.approveCount }] };
    }
    if (sql.includes("type = 'pact.legislation.proposed'")) {
      return { rows: [{ data: JSON.stringify(legislationPayload) }] };
    }
    // INSERT INTO events (emitEvent), UPDATE topics SET status = ...
    return { rows: [] };
  });
}

function callPost(topicId: string) {
  return POST(
    new Request(`http://localhost/api/pact/${topicId}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vote: "approve" }),
      // @ts-expect-error -- Node fetch requires duplex for streamed bodies
      duplex: "half",
    }) as never,
    { params: Promise.resolve({ topicId }) }
  );
}

function statusUpdates() {
  return executedStatements.filter((s) => s.sql.includes("UPDATE topics SET status ="));
}

function eventInserts() {
  return executedStatements
    .filter((s) => s.sql.startsWith("INSERT INTO events"))
    .map((s) => s.args[1] as string); // event type is the 2nd arg
}

beforeEach(() => {
  mockDb.execute.mockReset();
  ingestDocuments.mockClear();
  executedStatements.length = 0;
});

describe("POST /api/pact/{topicId}/vote — quorum transition (#5277)", () => {
  it("3rd approval on a legislation proposal fires the auto-ingest path (topic → consensus)", async () => {
    armDb({
      topic: { id: LEGISLATION_TOPIC_ID, title: "[Legislation Proposal] Moonside Report 2026" },
      approveCount: 3,
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("consensus");
    expect(body.approvals).toBe(3);

    // The SAME ingest path as the sweep: ingestDocuments ran with the
    // proposed document, the topic went to 'consensus' (never 'open'),
    // and pact.legislation.ingested was emitted.
    expect(ingestDocuments).toHaveBeenCalledTimes(1);
    expect(ingestDocuments).toHaveBeenCalledWith(mockDb, [legislationPayload.document]);

    const updates = statusUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("'consensus'");
    expect(updates[0].args).toEqual([LEGISLATION_TOPIC_ID]);

    const events = eventInserts();
    expect(events).toContain("pact.legislation.ingested");
    expect(events).not.toContain("pact.topic.approved");
  });

  it("3rd approval on a non-legislation topic opens it for debate (no ingest)", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Some ordinary institutional topic" },
      approveCount: 3,
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");

    expect(ingestDocuments).not.toHaveBeenCalled();

    const updates = statusUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("'open'");
    expect(updates[0].args).toEqual([PLAIN_TOPIC_ID]);

    const events = eventInserts();
    expect(events).toContain("pact.topic.approved");
    expect(events).not.toContain("pact.legislation.ingested");
  });

  it("below-quorum approval on a legislation proposal changes nothing (no ingest, no status change)", async () => {
    armDb({
      topic: { id: LEGISLATION_TOPIC_ID, title: "[Legislation Proposal] Moonside Report 2026" },
      approveCount: 2,
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.approvalsNeeded).toBe(1);

    expect(ingestDocuments).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(0);
    expect(eventInserts()).not.toContain("pact.legislation.ingested");
    expect(eventInserts()).not.toContain("pact.topic.approved");
  });
});
