/**
 * #5564 — the challenge-proposal wire: defeaterType + the §7.2 reopen bar,
 * additive and grandfathered.
 *
 * GET /api/pact/{topicId}/proposals serves `defeaterType` on every row (null
 * for rows filed before typed defeaters existed — grandfathered, never
 * backfilled) and now carries the reopen bar (`reopen.requiredSupportVotes`,
 * the same requiredReopenVotes binding evaluateChallenges enforces) on
 * challenge rows — previously served only under the dependencies route's
 * frontier block, NOT on the challenge itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DbClient, DbResult } from "@/lib/db";
import { requiredReopenVotes } from "@/lib/db";

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

const TOPIC_ID = "11111111-2222-3333-4444-555555555555";

function callGet() {
  return GET(new NextRequest(`http://localhost/api/pact/${TOPIC_ID}/proposals`), {
    params: Promise.resolve({ topicId: TOPIC_ID }),
  });
}

/** A proposal row as the GET's SELECT aliases it. */
function proposalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prop-1",
    sectionId: "sec:answer",
    status: "pending",
    summary: "An ordinary edit",
    created_at: "2026-02-01T00:00:00Z",
    ttl: 3600,
    authorName: "Agent One",
    authorId: "agent-1",
    citations: null,
    confidential: 0,
    public_summary: null,
    proposalType: "edit",
    defeaterType: null,
    approveCount: 0,
    objectCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mockDb.execute.mockReset();
});

describe("GET /api/pact/{topicId}/proposals — reopen bar on the challenge wire (#5564)", () => {
  it("serves defeaterType + reopen counts on challenge rows, and NOT on ordinary rows", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          proposalRow(), // ordinary pending edit
          proposalRow({
            id: "prop-challenge",
            status: "challenge",
            proposalType: "challenge",
            summary: "The cited register was superseded in 2025",
            defeaterType: "counter-evidence",
            approveCount: 2,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ dependent_count: 4 }] }); // dependents count

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    const ordinary = body.find((p: { id: string }) => p.id === "prop-1");
    const challenge = body.find((p: { id: string }) => p.id === "prop-challenge");

    expect(ordinary.reopen).toBeUndefined();
    expect(challenge.defeaterType).toBe("counter-evidence");
    // The bar is the SAME binding the sweep enforces: base + floor(sqrt(4)).
    expect(challenge.reopen).toEqual({
      requiredSupportVotes: requiredReopenVotes(4),
      dependentCount: 4,
      supportVotes: 2,
    });
  });

  it("grandfathers a pre-typed-defeater challenge row: defeaterType stays null, reopen still served", async () => {
    // A challenge filed before #3691 W4 typed defeaters existed: status says
    // challenge, defeater_type was never written. Served as-is — no
    // backfill, no 500 — and the reopen bar still rides alongside.
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          proposalRow({
            id: "prop-old-challenge",
            status: "challenge",
            proposalType: "edit",
            defeaterType: null,
            approveCount: 1,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ dependent_count: 0 }] });

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].defeaterType).toBeNull();
    expect(body[0].reopen).toEqual({
      requiredSupportVotes: requiredReopenVotes(0),
      dependentCount: 0,
      supportVotes: 1,
    });
  });

  it("keeps confidential redaction intact on challenge rows", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          proposalRow({
            id: "prop-confidential",
            status: "challenge",
            proposalType: "challenge",
            defeaterType: "scope-violation",
            confidential: 1,
            summary: "SECRET substance",
            public_summary: "A public summary",
            citations: '["sealed"]',
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ dependent_count: 1 }] });

    const res = await callGet();
    const body = await res.json();
    expect(body[0].summary).toBe("A public summary");
    expect(body[0].citations).toBeNull();
    expect(body[0].reopen.requiredSupportVotes).toBe(requiredReopenVotes(1));
  });

  it("a failed dependents count degrades additively — 200, rows served, no reopen key", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [proposalRow({ id: "p", status: "challenge", defeaterType: "bundling" })],
      })
      .mockRejectedValueOnce(new Error("relation topic_dependencies is on fire"));

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].id).toBe("p");
    expect(body[0].reopen).toBeUndefined();
  });

  it("pins the pre-existing row shape additively — a rename or removal fails", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [proposalRow()] })
      .mockResolvedValueOnce({ rows: [{ dependent_count: 0 }] });

    const res = await callGet();
    const body = await res.json();
    expect(Object.keys(body[0])).toEqual(
      expect.arrayContaining([
        "id",
        "sectionId",
        "status",
        "summary",
        "created_at",
        "ttl",
        "authorName",
        "authorId",
        "citations",
        "confidential",
        "public_summary",
        "proposalType",
        "defeaterType",
        "approveCount",
        "objectCount",
      ])
    );
  });
});
