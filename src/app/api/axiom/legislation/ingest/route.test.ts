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
const REVIEWED_AT = "2026-09-20T01:02:03.000Z";

/** Only scripts/run_reviewed_legislation_ingest.py sends this (tailor-group#35). */
const REVIEWED_ASSERTION = { "x-ingest-source": "reviewed" };

/** The pre-select an unasserted write makes; `marked` rows are skipped. */
function markedRows(marked: { id: string; reviewed_at: string }[]) {
  return async (statement: string | Statement): Promise<DbResult> => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    return { rows: sql.includes("reviewed_at IS NOT NULL") ? marked : [] };
  };
}

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
  mockDb.execute.mockReset().mockImplementation(markedRows([]));
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

  it("commits one reviewed batch, audits it, and preserves the runner's exact response envelope", async () => {
    const response = await postJson({
      documents: [validDocument({
        title: "  Judicial Review Act 1991  ",
        relatedDocs: [],
        sections: [
          { sectionId: "s 2", content: "Second", order: 2 },
          { sectionId: "s 1", content: "First", order: 1 },
        ],
      })],
    }, { headers: REVIEWED_ASSERTION });

    expect(response.status).toBe(200);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    // A reviewed write has no pre-select: it always replaces and re-stamps.
    expect(mockDb.execute).not.toHaveBeenCalled();
    const upserts = mockDb.batch.mock.calls[0][0]
      .filter((statement) => statement.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].sql).toContain("reviewed_at = NOW()");
    expect(upserts[0].sql).toContain("review_hash = excluded.review_hash");
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock.mock.calls[0][1]).toBe(mockDb);
    expect(recordAuditMock.mock.calls[0][0]).toMatchObject({
      after: { source: "reviewed", skippedDocumentIds: [] },
    });
    // scripts/run_reviewed_legislation_ingest.py rejects any other key set.
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

  it("an admin POST without the reviewed assertion never stamps and skips a marked document", async () => {
    // What the deploy-time SEQ seed does on every deploy (cd-kg.yml): the
    // Planning Act 2016 it scrapes is the manifest-reviewed qld/act-2016-025.
    mockDb.execute.mockImplementation(markedRows([{ id: "qld/act-2016-025", reviewed_at: REVIEWED_AT }]));

    const response = await postJson({
      documents: [
        validDocument({ id: "qld/act-2016-025", title: "Planning Act 2016 (Qld)", sections: [{ sectionId: "s 1", content: "scraped chunk" }] }),
        validDocument({ id: "qld/reg-2017-078", type: "regulation", title: "Planning Regulation 2017 (Qld)" }),
      ],
    });

    expect(response.status).toBe(200);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    const statements = mockDb.batch.mock.calls[0][0];
    expect(statements.some((statement) => statement.args.includes("qld/act-2016-025"))).toBe(false);
    const upserts = statements.filter((statement) => statement.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toBe("qld/reg-2017-078");
    expect(upserts[0].sql).not.toContain("reviewed_at");
    expect(upserts[0].sql).not.toContain("review_hash");
    expect(recordAuditMock.mock.calls[0][0]).toMatchObject({
      after: {
        source: "admin",
        documentIds: ["qld/reg-2017-078"],
        skippedDocumentIds: ["qld/act-2016-025"],
      },
    });
    expect(await response.json()).toEqual({
      ingested: 1,
      documents: [{ id: "qld/reg-2017-078", title: "Planning Regulation 2017 (Qld)", sectionsInserted: 1 }],
      skipped: [{ id: "qld/act-2016-025", reviewedAt: REVIEWED_AT }],
      message: "Successfully ingested 1 legislation document(s) with 1 total sections. Skipped 1 reviewed document(s).",
    });
  });

  it("an admin POST whose every document is marked writes nothing and says so", async () => {
    mockDb.execute.mockImplementation(markedRows([{ id: "qld/act-2016-025", reviewed_at: REVIEWED_AT }]));

    const response = await postJson({
      documents: [validDocument({ id: "qld/act-2016-025", title: "Planning Act 2016 (Qld)" })],
    });

    expect(response.status).toBe(200);
    expect(mockDb.batch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      ingested: 0,
      documents: [],
      skipped: [{ id: "qld/act-2016-025", reviewedAt: REVIEWED_AT }],
      message: "Successfully ingested 0 legislation document(s) with 0 total sections. Skipped 1 reviewed document(s).",
    });
  });

  it("rejects an unknown X-Ingest-Source before reading the body or acquiring the database", async () => {
    const response = await postJson(
      { documents: [validDocument()] },
      { headers: { "x-ingest-source": "seed" } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_ingest_source",
      message: 'X-Ingest-Source, when present, must be "reviewed".',
    });
    expect(getDbMock).not.toHaveBeenCalled();
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
