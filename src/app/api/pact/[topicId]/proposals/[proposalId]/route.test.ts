/**
 * #5535 — the single-proposal read: the §25 wire surface the two
 * internal-reversible execution-boundary vectors GET.
 *
 * The vectors themselves execute against this handler on real Postgres in
 * lib/execution-boundary-vectors.itest.ts; this suite pins the derivations
 * and the additive-degradation posture on the mock seam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DbClient, DbResult } from "@/lib/db";

type ExecuteArg = string | { sql: string; args: unknown[] };

const mockDb = {
  execute: vi.fn<(stmt: ExecuteArg) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: async () => mockDb as unknown as DbClient,
  };
});

import { GET } from "./route";

const TOPIC_ID = "topic-5535";
const PROPOSAL_ID = "prop-5535";

function callGet() {
  return GET(new NextRequest(`http://localhost/api/pact/${TOPIC_ID}/proposals/${PROPOSAL_ID}`), {
    params: Promise.resolve({ topicId: TOPIC_ID, proposalId: PROPOSAL_ID }),
  });
}

/** A joined row as the GET's SELECT aliases it. */
function joinedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROPOSAL_ID,
    topic_id: TOPIC_ID,
    sectionId: "sec:answer",
    status: "pending",
    summary: "An ordinary edit",
    created_at: "2026-02-01T00:00:00Z",
    resolved_at: null,
    ttl: 3600,
    citations: null,
    confidential: 0,
    public_summary: null,
    proposalType: "edit",
    defeaterType: null,
    authorName: "Agent One",
    authorId: "agent-1",
    topicStatus: "open",
    approveCount: 0,
    objectCount: 0,
    ...overrides,
  };
}

function mergeEvent(type: string, proposalId: string): Record<string, unknown> {
  return { type, data: JSON.stringify({ proposalId }) };
}

beforeEach(() => {
  mockDb.execute.mockReset();
});

describe("GET /api/pact/{topicId}/proposals/{proposalId} — §25 wire surface (#5535)", () => {
  it("404s deterministically for a missing proposal", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
    const res = await callGet();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Proposal not found" });
  });

  it("serves a pending proposal as protocol 'open' with the full §25.4 absence block", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [joinedRow()], rowsAffected: 1 });
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposalId).toBe(PROPOSAL_ID);
    expect(body.status).toBe("open");
    expect(body.kg_status).toBe("pending");
    expect(body.merged_by).toBeNull();
    expect(body.effect_class).toBe("internal-reversible");
    expect(body.human_attestation).toBe("not-required");
    expect(body.execution_state).toBe("none");
    expect(body.attested).toBe(false);
    expect(body.authorization_proof).toBeNull();
    expect(body.attestations).toEqual([]);
    expect(body.signature_records).toEqual([]);
  });

  it("derives auto-merged / protocol-timeout from the sweep's event (§25.3)", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [joinedRow({ status: "merged", resolved_at: "2026-02-02T00:00:00Z" })], rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [mergeEvent("pact.proposal.auto-merged", PROPOSAL_ID)],
        rowsAffected: 1,
      });
    const body = await (await callGet()).json();
    expect(body.status).toBe("auto-merged");
    expect(body.merged_by).toBe("protocol-timeout");
    expect(body.attested).toBe(false);
    expect(body.authorization_proof).toBeNull();
  });

  it("derives merged / approval-quorum from the approve route's event — never a principal", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [joinedRow({ status: "merged" })], rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [
          mergeEvent("pact.proposal.auto-merged", "some-other-proposal"),
          mergeEvent("pact.proposal.merged", PROPOSAL_ID),
        ],
        rowsAffected: 2,
      });
    const body = await (await callGet()).json();
    expect(body.status).toBe("merged");
    expect(body.merged_by).toBe("approval-quorum");
  });

  it("grandfathers a merged row whose merge events were purged: merged, merged_by null, no 500", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [joinedRow({ status: "merged" })], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("merged");
    expect(body.merged_by).toBeNull();
  });

  it("a failed provenance sub-query degrades additively — 200, merged, merged_by null", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [joinedRow({ status: "merged" })], rowsAffected: 1 })
      .mockRejectedValueOnce(new Error("events table is having a day"));
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("merged");
    expect(body.merged_by).toBeNull();
  });

  it("a converged topic serves execution_state 'unexecuted' — §25.8's explicit non-execution", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [joinedRow({ status: "merged", topicStatus: "consensus" })], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [mergeEvent("pact.proposal.merged", PROPOSAL_ID)], rowsAffected: 1 });
    const body = await (await callGet()).json();
    expect(body.execution_state).toBe("unexecuted");
  });

  it("keeps confidential redaction intact — the same rule as the collection route", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        joinedRow({
          confidential: 1,
          summary: "sealed reasoning",
          citations: '[{"topicId":"t","excerpt":"e"}]',
          public_summary: "A public summary",
        }),
      ],
      rowsAffected: 1,
    });
    const body = await (await callGet()).json();
    expect(body.summary).toBe("A public summary");
    expect(body.citations).toBeNull();
    expect(body.confidential).toBe(true);
  });

  it("skips the events query entirely for unmerged rows — one SELECT, no engine invocation", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [joinedRow()], rowsAffected: 1 });
    await callGet();
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });
});
