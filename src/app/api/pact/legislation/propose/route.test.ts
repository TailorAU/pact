import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

type Statement = { sql: string; args: unknown[] };

const mockDb = {
  execute: vi.fn<(statement: string | Statement) => Promise<DbResult>>(),
  batch: vi.fn(),
};
const getDbMock = vi.fn(async () => mockDb as unknown as DbClient);
const emitEventMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);

vi.mock("@/lib/db", () => ({
  getDb: () => getDbMock(),
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  requireAgent: vi.fn(async () => ({ id: "agent:test" })),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
  getRateLimitHeaders: vi.fn(() => ({})),
}));

import { POST } from "./route";

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: "qld/act-1999-039",
    jurisdiction: " qld ",
    type: "ACT",
    title: " Judicial Review Act 1991 ",
    sections: [{ sectionId: " s 1 ", content: "" }],
    ...overrides,
  };
}

function request(payload: unknown): Request {
  return new Request("http://localhost/api/pact/legislation/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  mockDb.execute.mockReset().mockResolvedValue({ rows: [] });
  mockDb.batch.mockReset();
  getDbMock.mockReset().mockResolvedValue(mockDb as unknown as DbClient);
  emitEventMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/pact/legislation/propose", () => {
  it.each([
    ["missing type", document({ type: undefined }), "documents[0].type"],
    [
      "missing section content",
      document({ sections: [{ sectionId: "s 1" }] }),
      "documents[0].sections[0].content",
    ],
    ["unknown document field", document({ unexpected: true }), "documents[0]"],
  ])("rejects %s with a safe 422 before proposal writes", async (_case, invalid, path) => {
    const response = await POST(request({
      document: invalid,
      summary: "Authoritative gazette transcription.",
    }) as never);

    expect(response.status).toBe(422);
    const body = await response.json() as {
      error: string;
      issues: Array<{ path: string }>;
    };
    expect(body.error).toBe("invalid_legislation_payload");
    expect(body.issues.map((issue) => issue.path)).toContain(path);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("persists a valid #5277 proposal with the shared normalized document", async () => {
    const response = await POST(request({
      document: document(),
      summary: "Authoritative gazette transcription.",
    }) as never);

    expect(response.status).toBe(201);
    expect(getDbMock).toHaveBeenCalledOnce();
    // #5566 — the pending-document event goes through emitEvent (and so onto
    // the §6.4 chain) instead of a direct INSERT INTO events.
    const proposedEvent = emitEventMock.mock.calls.find(
      (call) => call[2] === "pact.legislation.proposed"
    );
    expect(proposedEvent).toBeDefined();
    const persisted = proposedEvent?.[5] as {
      document: Record<string, unknown> & {
        sections: Array<Record<string, unknown>>;
      };
    };
    expect(persisted.document).toMatchObject({
      id: "qld/act-1999-039",
      jurisdiction: "QLD",
      type: "act",
      title: "Judicial Review Act 1991",
      shortTitle: null,
      year: null,
    });
    expect(persisted.document).not.toHaveProperty("relatedDocs");
    expect(persisted.document.sections[0]).toMatchObject({
      sectionId: "s 1",
      content: "",
      depth: 2,
      order: 0,
      status: "in_force",
      crossReferences: [],
    });
  });

  it("#5459 — does NOT insert a proposer self-approve vote (quorum means N OTHER voters)", async () => {
    const response = await POST(request({
      document: document(),
      summary: "Authoritative gazette transcription.",
    }) as never);

    expect(response.status).toBe(201);
    const voteInserts = mockDb.execute.mock.calls
      .map(([statement]) => statement)
      .filter((statement): statement is Statement =>
        typeof statement !== "string" && statement.sql.includes("INSERT INTO topic_votes"));
    expect(voteInserts).toEqual([]);

    // The proposer is still registered as creator — that registration is
    // what excludes the proposer's class from its own quorum count.
    const creatorRegistration = mockDb.execute.mock.calls
      .map(([statement]) => statement)
      .find((statement): statement is Statement =>
        typeof statement !== "string" && statement.sql.includes("INSERT INTO registrations"));
    expect(creatorRegistration?.args).toContain("creator");
  });
});
