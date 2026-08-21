import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";
import { hashCanonicalLegislation } from "@/lib/legislation-canonical";

type MockDb = {
  execute: ReturnType<
    typeof vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>
  >;
  batch: ReturnType<typeof vi.fn>;
};

const mockDb: MockDb = {
  execute: vi.fn(),
  batch: vi.fn(),
};
const mockGetDb = vi.fn(async () => mockDb as unknown as DbClient);

vi.mock("@/lib/db", () => ({
  getDb: () => mockGetDb(),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: {
    error: (...args: unknown[]) => mockLogError(...args),
  },
}));

import { GET } from "./route";

function rows(resultRows: Record<string, unknown>[]): DbResult {
  return { rows: resultRows as never[] };
}

function canonicalRow(): Record<string, unknown> {
  return {
    id: "qld/act-2016-025",
    jurisdiction: "AU-QLD",
    doc_type: "act",
    title: "Planning Act 2016",
    short_title: "Planning Act",
    year: 2016,
    number: "25",
    in_force_date: "2017-07-03",
    last_amended_date: "2025-05-01",
    repealed_date: null,
    administered_by: "Department of State Development",
    legislation_url: "https://example.test/planning-act",
    sections: [
      {
        section_id: "s 2",
        title: "Definitions",
        content: "Meaning.",
        depth: 2,
        parent_section: "pt 1",
        order: 2,
        status: "in_force",
        amended_by: null,
        cross_references: '["s 3","s 1"]',
        notes: "Current consolidation",
      },
      {
        section_id: "s 1",
        title: null,
        content: "  whitespace is exact  ",
        depth: 1,
        parent_section: null,
        order: 1,
        status: "in_force",
        amended_by: null,
        cross_references: null,
        notes: null,
      },
    ],
    related_docs: ["qld/reg-b", "qld/reg-a"],
  };
}

function callGet(query = "") {
  return GET(new Request(`http://localhost/api/axiom/legislation${query}`) as never);
}

beforeEach(() => {
  mockDb.execute.mockReset();
  mockGetDb.mockClear();
  mockLogError.mockClear();
});

describe("GET /api/axiom/legislation — canonical exact-ID state", () => {
  it("resolves a slash-bearing ID by exact equality in one snapshot query", async () => {
    mockDb.execute.mockResolvedValueOnce(rows([canonicalRow()]));

    const res = await callGet("?id=qld%2Fact-2016-025&format=canonical");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(mockGetDb).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);

    const statement = mockDb.execute.mock.calls[0][0] as { sql: string; args: unknown[] };
    expect(statement.args).toEqual(["qld/act-2016-025"]);
    expect(statement.sql).toContain("WHERE d.id = ?");
    expect(statement.sql).toContain("LEFT JOIN LATERAL");
    expect(statement.sql).toContain("jsonb_agg");
    expect(statement.sql).toContain("'section_id'");
    expect(statement.sql).not.toContain("'sectionId'");
    expect(statement.sql).toContain("lr.relation_type = 'subordinate'");
    expect(statement.sql).not.toContain("d.*");
    expect(statement.sql).not.toContain("created_at");

    const body = (await res.json()) as {
      document: Record<string, unknown> & { sections: Array<Record<string, unknown>> };
      sectionCount: number;
      digestVersion: string;
      payloadHash: string;
    };
    expect(body.document).toMatchObject({
      id: "qld/act-2016-025",
      jurisdiction: "AU-QLD",
      type: "act",
      title: "Planning Act 2016",
      relatedDocs: ["qld/reg-a", "qld/reg-b"],
    });
    expect(body.document.sections.map((section) => section.sectionId)).toEqual(["s 1", "s 2"]);
    expect(body.document.sections[0].content).toBe("  whitespace is exact  ");
    expect(body.document.sections[1].crossReferences).toEqual(["s 1", "s 3"]);
    expect(body.sectionCount).toBe(2);
    expect(body.digestVersion).toBe("legislation-payload-v1");
    expect(body.payloadHash).toBe(hashCanonicalLegislation(body.document as never));
    expect(body.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an uncached 404 for an exact miss", async () => {
    mockDb.execute.mockResolvedValueOnce(rows([]));

    const res = await callGet("?id=cth%2Fact-missing&format=canonical");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await res.json()).toEqual({
      error: "legislation_not_found",
      id: "cth/act-missing",
    });
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("trims query whitespace while preserving canonical ID case and punctuation", async () => {
    mockDb.execute.mockResolvedValueOnce(rows([]));

    await callGet("?id=%20QLD%2FLocal-Law%3A2026-(No.7)%20&format=canonical");
    const statement = mockDb.execute.mock.calls[0][0] as { args: unknown[] };
    expect(statement.args).toEqual(["QLD/Local-Law:2026-(No.7)"]);
  });

  it("fails closed and uncached when persisted state cannot be projected", async () => {
    mockDb.execute.mockResolvedValueOnce(rows([{ ...canonicalRow(), sections: "not-json" }]));

    const res = await callGet("?id=qld%2Fact-2016-025&format=canonical");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await res.json()).toEqual({
      error: "canonical_state_invalid",
      id: "qld/act-2016-025",
    });
    expect(mockLogError).toHaveBeenCalledOnce();
  });

  it("fails safely and uncached when the exact-state query is unavailable", async () => {
    mockDb.execute.mockRejectedValueOnce(Object.assign(
      new Error("password=secret SQL unavailable"),
      { code: "08006" },
    ));

    const res = await callGet("?id=qld%2Fact-2016-025&format=canonical");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      error: "canonical_state_unavailable",
      id: "qld/act-2016-025",
    });
    expect(mockLogError).toHaveBeenCalledWith(
      {
        op: "axiom.legislation.canonical.query_failed",
        docId: "qld/act-2016-025",
        databaseCode: "08006",
      },
      "canonical legislation state query failed",
    );
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain("password=secret");
  });

  it("fails safely and uncached when database initialization is unavailable", async () => {
    mockGetDb.mockRejectedValueOnce(Object.assign(
      new Error("password=secret database initialization failed"),
      { code: "08001" },
    ));

    const res = await callGet("?id=qld%2Fact-2016-025&format=canonical");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      error: "canonical_state_unavailable",
      id: "qld/act-2016-025",
    });
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      {
        op: "axiom.legislation.canonical.query_failed",
        docId: "qld/act-2016-025",
        databaseCode: "08001",
      },
      "canonical legislation state query failed",
    );
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain("password=secret");
  });

  it.each([
    ["missing id", "?format=canonical", "canonical_id_required"],
    ["duplicate id", "?id=a&id=b&format=canonical", "canonical_id_required"],
    ["control character", "?id=a%0Ab&format=canonical", "canonical_id_invalid"],
    ["oversized id", `?id=${"a".repeat(257)}&format=canonical`, "canonical_id_invalid"],
    ["partial metadata", "?id=a&format=canonical&include=metadata", "canonical_filters_not_supported"],
    ["hidden partial metadata", "?id=a&format=canonical&include=sections&include=metadata", "canonical_filters_not_supported"],
    ["search filter", "?id=a&format=canonical&q=title", "canonical_filters_not_supported"],
    ["section filter", "?id=a&format=canonical&section=s1", "canonical_filters_not_supported"],
  ])("rejects %s before opening a database client", async (_case, query, error) => {
    const res = await callGet(query);
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error });
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

describe("GET /api/axiom/legislation — legacy response compatibility", () => {
  it("keeps the existing JSON list DTO when canonical format is not requested", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([{ total: 1 }]))
      .mockResolvedValueOnce(rows([{
        id: "qld/act-2016-025",
        jurisdiction: "AU-QLD",
        doc_type: "act",
        title: "Planning Act 2016",
        short_title: "Planning Act",
        year: 2016,
        number: "25",
        in_force_date: "2017-07-03",
        last_amended_date: null,
        repealed_date: null,
        administered_by: null,
        legislation_url: null,
      }]))
      .mockResolvedValueOnce(rows([{
        section_id: "s 1",
        title: "Purpose",
        content: "Purpose text",
        depth: 1,
        parent_section: null,
        sort_order: 0,
        status: "in_force",
        amended_by: null,
        cross_references: null,
        notes: null,
      }]))
      .mockResolvedValueOnce(rows([]));

    const res = await callGet("?jurisdiction=QLD");
    const body = (await res.json()) as {
      legislation: Array<Record<string, unknown>>;
      total: number;
      limit: number;
      offset: number;
      free: boolean;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 1, limit: 50, offset: 0, free: true });
    expect(body.legislation[0]).toMatchObject({
      id: "qld/act-2016-025",
      type: "act",
      sections: [{ sectionId: "s 1", parentId: null, order: 0 }],
    });
    expect(body.legislation[0]).not.toHaveProperty("payloadHash");
    expect(mockDb.execute).toHaveBeenCalledTimes(4);
  });
});
