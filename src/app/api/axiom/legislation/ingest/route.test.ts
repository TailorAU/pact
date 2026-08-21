import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";
import { ADMIN_INGEST_MAX_BODY_BYTES } from "@/lib/read-body-bounded";

type Statement = { sql: string; args: unknown[] };

const mockDb = {
  execute: vi.fn<(statement: string | Statement) => Promise<DbResult>>(),
  batch: vi.fn<(statements: Statement[]) => Promise<void>>(),
};
const getDbMock = vi.fn(async () => mockDb as unknown as DbClient);
const recordAuditMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const errorLogMock = vi.fn<(...args: unknown[]) => void>();

vi.mock("@/lib/db", () => ({
  getDb: () => getDbMock(),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAuditMock(...args),
  ipCountryFromHeaders: vi.fn(() => "AU"),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: (...args: unknown[]) => errorLogMock(...args) },
}));

import { POST } from "./route";

const originalAdminSecret = process.env.ADMIN_SECRET;

function validDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "qld/act-1999-039",
    jurisdiction: "QLD",
    type: "act",
    title: "Judicial Review Act 1991",
    sections: [{ sectionId: "s 1", content: "Short title" }],
    ...overrides,
  };
}

function request(
  body: string,
  options: { adminKey?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-admin-key": options.adminKey ?? "test-admin-secret",
    ...options.headers,
  });
  return new Request("http://localhost/api/axiom/legislation/ingest", {
    method: "POST",
    headers,
    body,
  });
}

async function postJson(body: unknown, options?: Parameters<typeof request>[1]) {
  return POST(request(JSON.stringify(body), options) as never);
}

beforeEach(() => {
  process.env.ADMIN_SECRET = "test-admin-secret";
  mockDb.execute.mockReset();
  mockDb.batch.mockReset().mockResolvedValue(undefined);
  getDbMock.mockReset().mockResolvedValue(mockDb as unknown as DbClient);
  recordAuditMock.mockReset().mockResolvedValue(undefined);
  errorLogMock.mockReset();
});

afterAll(() => {
  if (originalAdminSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalAdminSecret;
});

describe("POST /api/axiom/legislation/ingest", () => {
  it("uses the shared admin contract and fails closed when ADMIN_SECRET is missing", async () => {
    delete process.env.ADMIN_SECRET;

    const response = await postJson({ documents: [validDocument()] });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Server misconfigured: ADMIN_SECRET is not set" });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("returns 401 without the correct admin key", async () => {
    const response = await postJson(
      { documents: [validDocument()] },
      { adminKey: "wrong-key" },
    );

    expect(response.status).toBe(401);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("returns 413 before parsing or database acquisition", async () => {
    const response = await POST(request(
      "{}",
      { headers: { "content-length": String(ADMIN_INGEST_MAX_BODY_BYTES + 1) } },
    ) as never);

    expect(response.status).toBe(413);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("returns a safe 400 for malformed JSON before database acquisition", async () => {
    const response = await POST(request("{not-json") as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing sections", validDocument({ sections: undefined })],
    ["empty sections", validDocument({ sections: [] })],
    ["missing ID", validDocument({ id: undefined })],
  ])("returns 422 for %s without acquiring the database", async (_name, invalidDocument) => {
    const response = await postJson({ documents: [invalidDocument] });

    expect(response.status).toBe(422);
    const body = await response.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_legislation_payload");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("validates the complete request before a valid leading document can mutate", async () => {
    const response = await postJson({
      documents: [validDocument(), validDocument({ id: "qld/act-bad", sections: [] })],
    });

    expect(response.status).toBe(422);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(mockDb.batch).not.toHaveBeenCalled();
  });

  it("commits one batch, audits it, and preserves the existing response envelope", async () => {
    const response = await postJson({
      documents: [validDocument({
        title: "  Judicial Review Act 1991  ",
        relatedDocs: [],
        sections: [
          { sectionId: "s 2", content: "Second", order: 2 },
          { sectionId: "s 1", content: "First", order: 1 },
        ],
      })],
    });

    expect(response.status).toBe(200);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock.mock.calls[0][1]).toBe(mockDb);
    expect(await response.json()).toEqual({
      ingested: 1,
      documents: [{
        id: "qld/act-1999-039",
        title: "Judicial Review Act 1991",
        sectionsInserted: 2,
      }],
      message: "Successfully ingested 1 legislation document(s) with 2 total sections.",
    });
  });

  it("preserves request order in the response and audit while sorting transaction locks", async () => {
    const response = await postJson({
      documents: [
        validDocument({ id: "z/doc", title: "Z document" }),
        validDocument({ id: "a/doc", title: "A document" }),
      ],
    });

    expect(response.status).toBe(200);
    const statements = mockDb.batch.mock.calls[0][0];
    const upsertIds = statements
      .filter((statement) => statement.sql.includes("INSERT INTO legislation_docs"))
      .map((statement) => statement.args[0]);
    expect(upsertIds).toEqual(["a/doc", "z/doc"]);

    const body = await response.json() as {
      documents: Array<{ id: string }>;
    };
    expect(body.documents.map((document) => document.id)).toEqual(["z/doc", "a/doc"]);
    expect(recordAuditMock.mock.calls[0][0]).toMatchObject({
      entityId: "z/doc",
      after: { documentIds: ["z/doc", "a/doc"] },
    });
  });

  it("maps an invalid related-document foreign key to a safe 422", async () => {
    mockDb.batch.mockRejectedValueOnce(Object.assign(
      new Error("insert or update violates constraint legislation_relations_to_doc_id_fkey"),
      { code: "23503", detail: "raw database detail" },
    ));

    const response = await postJson({
      documents: [validDocument({ relatedDocs: ["missing/doc"] })],
    });

    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain("invalid_reference");
    expect(text).not.toContain("constraint");
    expect(text).not.toContain("raw database detail");
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("returns a generic 500 without echoing raw persistence errors", async () => {
    mockDb.batch.mockRejectedValueOnce(new Error("password=secret SQL exploded"));

    const response = await postJson({ documents: [validDocument()] });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("ingest_failed");
    expect(text).not.toContain("password=secret");
    expect(errorLogMock).toHaveBeenCalledWith(
      { op: "axiom.legislation.ingest.failed", databaseCode: null },
      "legislation replacement transaction failed",
    );
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});
