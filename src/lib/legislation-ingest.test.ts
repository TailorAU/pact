import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./db";
import {
  LegislationValidationError,
  normalizeLegislationDocuments,
  normalizeLegislationRequest,
  replaceLegislationDocuments,
  reviewHashForDocument,
  type LegislationDocumentInput,
  type NormalizedLegislationDocument,
} from "./legislation-ingest";
import { hashCanonicalLegislation } from "./legislation-canonical";

type Statement = { sql: string; args: unknown[] };
const REVIEWED: { source: "reviewed" } = { source: "reviewed" };
const SCHEDULED: { source: "scheduled" } = { source: "scheduled" };

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "qld/act-1999-039",
    jurisdiction: "QLD",
    type: "act",
    title: "Judicial Review Act 1991",
    sections: [{ sectionId: "s 1", content: "Text", order: 0 }],
    ...overrides,
  };
}

function dbWithBatch(
  batch: DbClient["batch"] = async () => undefined,
): DbClient {
  return {
    execute: vi.fn(async () => ({ rows: [] })),
    batch,
  };
}

function normalizeOne(overrides: Record<string, unknown> = {}): NormalizedLegislationDocument {
  return normalizeLegislationDocuments([document(overrides)])[0];
}

interface LegislationUrlVector {
  name: string;
  url: string;
  sourceAccepts: boolean;
  runnerAccepts: boolean;
}

const legislationUrlVectors = JSON.parse(readFileSync(
  new URL("../../scripts/tests/fixtures/legislation_url_vectors.json", import.meta.url),
  "utf8",
)) as LegislationUrlVector[];

describe("legislation ingest validation and normalization", () => {
  it("normalizes every replacement-controlled field deterministically", () => {
    const [normalized] = normalizeLegislationRequest({
      documents: [document({
        id: "  qld/act-1999-039  ",
        jurisdiction: " qld ",
        type: " ACT ",
        title: "  Judicial Review Act 1991  ",
        shortTitle: "   ",
        year: null,
        number: "  Act 100  ",
        inForceDate: " 1991-12-20 ",
        lastAmendedDate: null,
        repealedDate: "",
        administeredBy: "  Department of Justice  ",
        legislationUrl: " https://www.legislation.qld.gov.au/example ",
        sections: [
          {
            sectionId: " s 2 ",
            title: "  Scope  ",
            content: "  legally-significant whitespace\n",
            depth: 1,
            parentSection: " ",
            order: 2,
            status: " REPEALED ",
            amendedBy: null,
            crossReferences: [" s 9 ", "s 3"],
            notes: "  historical note  ",
          },
          { sectionId: "s 1", content: "", crossReferences: [] },
        ],
        relatedDocs: [" qld/reg-2020-002 ", "qld/act-2000-001"],
      })],
    });

    expect(normalized).toEqual({
      id: "qld/act-1999-039",
      jurisdiction: "QLD",
      type: "act",
      title: "Judicial Review Act 1991",
      shortTitle: null,
      year: null,
      number: "Act 100",
      inForceDate: "1991-12-20",
      lastAmendedDate: null,
      repealedDate: null,
      administeredBy: "Department of Justice",
      legislationUrl: "https://www.legislation.qld.gov.au/example",
      sections: [
        {
          sectionId: "s 1",
          title: null,
          content: "",
          depth: 2,
          parentSection: null,
          order: 1,
          status: "in_force",
          amendedBy: null,
          crossReferences: [],
          notes: null,
        },
        {
          sectionId: "s 2",
          title: "Scope",
          content: "  legally-significant whitespace\n",
          depth: 1,
          parentSection: null,
          order: 2,
          status: "repealed",
          amendedBy: null,
          crossReferences: ["s 3", "s 9"],
          notes: "historical note",
        },
      ],
      relatedDocs: ["qld/act-2000-001", "qld/reg-2020-002"],
    });
  });

  it("preserves relatedDocs omission and distinguishes an explicit clear", () => {
    const omitted = normalizeOne();
    const explicit = normalizeOne({ relatedDocs: [] });

    expect(Object.hasOwn(omitted, "relatedDocs")).toBe(false);
    expect(explicit.relatedDocs).toEqual([]);
  });

  it("sorts reference sets by Unicode code point across the BMP boundary", () => {
    const bmp = "doc/\uE000";
    const astral = "doc/\u{10000}";
    const normalized = normalizeOne({
      sections: [{
        sectionId: "s 1",
        content: "Text",
        crossReferences: [astral, bmp],
      }],
      relatedDocs: [astral, bmp],
    });

    expect(normalized.sections[0].crossReferences).toEqual([bmp, astral]);
    expect(normalized.relatedDocs).toEqual([bmp, astral]);
  });

  it.each(["local_law", "planning_scheme"] as const)(
    "accepts the live %s proposal type",
    (type) => {
      expect(normalizeOne({ type }).type).toBe(type);
    },
  );

  it.each(legislationUrlVectors)(
    "classifies shared URL vector: $name",
    ({ url, sourceAccepts }) => {
      if (sourceAccepts) {
        expect(() => normalizeOne({ legislationUrl: url })).not.toThrow();
      } else {
        expect(() => normalizeOne({ legislationUrl: url })).toThrow(
          LegislationValidationError,
        );
      }
    },
  );

  it("trims IDs without rewriting compatible live or future canonical forms", () => {
    const ids = [
      "cth/determination-2017-841",
      "qld/bcc/city-plan-2014",
      "tas/sr-2016-041",
      "AU/Standard-AS_NZS.4308:2008",
    ];

    for (const id of ids) {
      expect(normalizeOne({ id: `  ${id}  ` }).id).toBe(id);
    }
  });

  it.each([
    ["missing sections", document({ sections: undefined }), "documents[0].sections"],
    ["empty sections", document({ sections: [] }), "documents[0].sections"],
    ["duplicate section IDs", document({ sections: [
      { sectionId: "s 1", content: "A", order: 0 },
      { sectionId: " s 1 ", content: "B", order: 1 },
    ] }), "documents[0].sections[1].sectionId"],
    ["duplicate section order", document({ sections: [
      { sectionId: "s 1", content: "A", order: 3 },
      { sectionId: "s 2", content: "B", order: 3 },
    ] }), "documents[0].sections[1].order"],
    ["invalid document enum", document({ type: "bill" }), "documents[0].type"],
    ["invalid section enum", document({ sections: [
      { sectionId: "s 1", content: "A", status: "draft" },
    ] }), "documents[0].sections[0].status"],
    ["invalid calendar date", document({ inForceDate: "2024-02-30" }), "documents[0].inForceDate"],
    ["invalid URL", document({ legislationUrl: "file:///etc/passwd" }), "documents[0].legislationUrl"],
    ["blank cross-reference", document({ sections: [
      { sectionId: "s 1", content: "A", crossReferences: [" "] },
    ] }), "documents[0].sections[0].crossReferences[0]"],
    ["blank related document", document({ relatedDocs: [" "] }), "documents[0].relatedDocs[0]"],
    ["self relation", document({ relatedDocs: ["qld/act-1999-039"] }), "documents[0].relatedDocs"],
    ["unknown document field", document({ typoTitle: "wrong" }), "documents[0]"],
  ])("rejects %s", (_name, invalidDocument, expectedPath) => {
    try {
      normalizeLegislationDocuments([invalidDocument]);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LegislationValidationError);
      expect((error as LegislationValidationError).issues.map((issue) => issue.path)).toContain(expectedPath);
    }
  });

  it("rejects duplicate normalized document IDs", () => {
    expect(() => normalizeLegislationDocuments([
      document({ id: "qld/act-1", title: "First" }),
      document({ id: " qld/act-1 ", title: "Second" }),
    ])).toThrow(LegislationValidationError);
  });

  it("caps safe validation details", () => {
    try {
      normalizeLegislationDocuments(Array.from({ length: 10 }, () => ({})));
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LegislationValidationError);
      expect((error as LegislationValidationError).issues).toHaveLength(20);
      expect((error as LegislationValidationError).truncated).toBe(true);
    }
  });
});

describe("atomic legislation persistence", () => {
  it("writes all metadata, sections and explicit relations in one deterministic batch", async () => {
    const batch = vi.fn<(statements: { sql: string; args: unknown[] }[]) => Promise<void>>(
      async () => undefined,
    );
    const db = dbWithBatch(batch);
    const documents = normalizeLegislationDocuments([
      document({
        id: "z/doc",
        jurisdiction: "nsw",
        type: "regulation",
        title: "Z document",
        shortTitle: null,
        year: null,
        number: null,
        inForceDate: null,
        lastAmendedDate: null,
        repealedDate: null,
        administeredBy: null,
        legislationUrl: null,
        relatedDocs: ["a/doc"],
      }),
      document({ id: "a/doc", title: "A document" }),
    ]);

    const result = await replaceLegislationDocuments(db, documents, REVIEWED);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(db.execute).not.toHaveBeenCalled();
    const statements = batch.mock.calls[0][0];
    const upserts = statements.filter((statement) => statement.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts.map((statement) => statement.args[0])).toEqual(["a/doc", "z/doc"]);
    expect(upserts[0].sql).toContain("jurisdiction = excluded.jurisdiction");
    expect(upserts[0].sql).toContain("doc_type = excluded.doc_type");
    expect(upserts[0].sql).toContain("year = excluded.year");
    expect(upserts[0].sql).toContain("number = excluded.number");
    expect(upserts[0].sql).toContain("in_force_date = excluded.in_force_date");
    expect(upserts[0].sql).toContain("legislation_url = excluded.legislation_url");

    const relationDeletes = statements.filter((statement) => statement.sql.includes("DELETE FROM legislation_relations"));
    expect(relationDeletes).toHaveLength(1);
    expect(relationDeletes[0].args).toEqual(["z/doc"]);
    expect(relationDeletes[0].sql).toContain("from_doc_id = ? AND relation_type = 'subordinate'");

    const relationInsertIndex = statements.findIndex((statement) => statement.sql.includes("INSERT INTO legislation_relations"));
    const lastDocumentUpsertIndex = statements.map((statement) => statement.sql).lastIndexOf(upserts[1].sql);
    const lastSectionInsertIndex = statements.map((statement) => statement.sql)
      .map((sql, index) => sql.includes("INSERT INTO legislation_sections") ? index : -1)
      .reduce((max, index) => Math.max(max, index), -1);
    expect(relationInsertIndex).toBeGreaterThan(lastDocumentUpsertIndex);
    expect(relationInsertIndex).toBeGreaterThan(lastSectionInsertIndex);
    expect(statements[relationInsertIndex].args.slice(1)).toEqual(["z/doc", "a/doc"]);
    expect(result).toEqual({
      ingested: 2,
      sectionsTotal: 2,
      documents: [
        { id: "z/doc", title: "Z document", sectionsInserted: 1 },
        { id: "a/doc", title: "A document", sectionsInserted: 1 },
      ],
      skipped: [],
    });
  });

  it("emits the owned-relation delete for explicit [] and no relation inserts", async () => {
    const batch = vi.fn<(statements: { sql: string; args: unknown[] }[]) => Promise<void>>(
      async () => undefined,
    );
    await replaceLegislationDocuments(dbWithBatch(batch), [normalizeOne({ relatedDocs: [] })], REVIEWED);

    const statements = batch.mock.calls[0][0];
    expect(statements.some((statement) => statement.sql.includes("DELETE FROM legislation_relations"))).toBe(true);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO legislation_relations"))).toBe(false);
  });

  it("leaves the prior state intact when any statement in the request fails", async () => {
    const committed = { marker: "prior-complete-state" };
    const batch = vi.fn(async (statements: { sql: string; args: unknown[] }[]) => {
      const candidate = { marker: "new-state" };
      expect(candidate.marker).toBe("new-state");
      if (statements.some((statement) =>
        statement.sql.includes("INSERT INTO legislation_relations") && statement.args[2] === "missing/doc")) {
        const error = Object.assign(new Error("foreign key detail must not escape"), { code: "23503" });
        throw error;
      }
      committed.marker = candidate.marker;
    });

    await expect(replaceLegislationDocuments(
      dbWithBatch(batch),
      [normalizeOne({ relatedDocs: ["missing/doc"] })],
      REVIEWED,
    )).rejects.toMatchObject({ code: "23503" });
    expect(committed).toEqual({ marker: "prior-complete-state" });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("commits concurrent same-ID requests as one complete payload, never a hybrid", async () => {
    let queue = Promise.resolve();
    let committed: { title: unknown; content: unknown; relatedDoc: unknown } | null = null;
    const batch = vi.fn((statements: { sql: string; args: unknown[] }[]) => {
      const run = queue.then(async () => {
        await Promise.resolve();
        const doc = statements.find((statement) => statement.sql.includes("INSERT INTO legislation_docs"));
        const section = statements.find((statement) => statement.sql.includes("INSERT INTO legislation_sections"));
        const relation = statements.find((statement) => statement.sql.includes("INSERT INTO legislation_relations"));
        committed = {
          title: doc?.args[3],
          content: section?.args[4],
          relatedDoc: relation?.args[2],
        };
      });
      queue = run.catch(() => undefined);
      return run;
    });
    const db = dbWithBatch(batch);
    const payloadA = normalizeOne({
      title: "Payload A",
      sections: [{ sectionId: "s 1", content: "Content A" }],
      relatedDocs: ["related/a"],
    });
    const payloadB = normalizeOne({
      title: "Payload B",
      sections: [{ sectionId: "s 1", content: "Content B" }],
      relatedDocs: ["related/b"],
    });

    await Promise.all([
      replaceLegislationDocuments(db, [payloadA], REVIEWED),
      replaceLegislationDocuments(db, [payloadB], REVIEWED),
    ]);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(committed).toEqual({ title: "Payload B", content: "Content B", relatedDoc: "related/b" });
  });

  it("refuses a write that does not declare its source", async () => {
    const batch = vi.fn(async () => undefined);
    await expect(replaceLegislationDocuments(
      dbWithBatch(batch),
      [normalizeOne()],
      undefined as never,
    )).rejects.toThrow(/explicit source/);
    await expect(replaceLegislationDocuments(
      dbWithBatch(batch),
      [normalizeOne()],
      { source: "cron" } as never,
    )).rejects.toThrow(/explicit source/);
    expect(batch).not.toHaveBeenCalled();
  });

  it("keeps the shared parser DTO compatible with deterministic defaults", () => {
    const parserDocument: LegislationDocumentInput = {
      id: "cth/act-1988-119",
      jurisdiction: "CTH",
      type: "act",
      title: "Privacy Act 1988",
      sections: [{ sectionId: "s 1", content: "Short title" }],
    };

    expect(normalizeLegislationDocuments([parserDocument])[0].sections[0]).toMatchObject({
      depth: 2,
      order: 0,
      status: "in_force",
      crossReferences: [],
    });
  });
});

describe("reviewed-document guard (tailor-group#35)", () => {
  const REVIEWED_AT = "2026-09-20T01:02:03.000Z";

  function markedDb(
    marked: { id: string; reviewed_at: unknown }[],
    batch: DbClient["batch"] = async () => undefined,
  ): DbClient & { execute: ReturnType<typeof vi.fn> } {
    return {
      execute: vi.fn(async (statement: string | Statement) => {
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (sql.includes("reviewed_at IS NOT NULL")) return { rows: marked };
        return { rows: [] };
      }),
      batch,
    };
  }

  /** The document id each statement acts on (section and relation inserts carry it second). */
  function idsTouched(statements: Statement[]): Set<unknown> {
    return new Set(statements.map((s) => s.args[
      s.sql.includes("INSERT INTO legislation_sections") || s.sql.includes("INSERT INTO legislation_relations") ? 1 : 0
    ]));
  }

  it("a scheduled payload for a marked id leaves it untouched and writes the other documents", async () => {
    const batch = vi.fn<(statements: Statement[]) => Promise<void>>(async () => undefined);
    const db = markedDb([{ id: "a/doc", reviewed_at: REVIEWED_AT }], batch);
    const documents = normalizeLegislationDocuments([
      document({ id: "z/doc", title: "Z document", relatedDocs: ["b/doc"] }),
      document({ id: "a/doc", title: "Planning Act 2016", sections: [{ sectionId: "s 1", content: "parser output" }] }),
      document({ id: "b/doc", title: "B document" }),
    ]);

    const result = await replaceLegislationDocuments(db, documents, SCHEDULED);

    // One pre-select over the batch's ids, before the batch.
    expect(db.execute).toHaveBeenCalledTimes(1);
    const select = db.execute.mock.calls[0][0] as Statement;
    expect(select.sql).toContain("FROM legislation_docs");
    expect(select.sql).toContain("reviewed_at IS NOT NULL");
    expect(select.args).toEqual(["a/doc", "b/doc", "z/doc"]);
    expect(db.execute.mock.invocationCallOrder[0]).toBeLessThan(batch.mock.invocationCallOrder[0]);

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0][0];
    // No upsert, no section DELETE/INSERT, no relation statement for the marked id.
    expect(idsTouched(statements)).toEqual(new Set(["b/doc", "z/doc"]));
    expect(statements.some((s) => s.args.includes("a/doc"))).toBe(false);
    expect(statements.filter((s) => s.sql.includes("DELETE FROM legislation_sections")).map((s) => s.args[0]))
      .toEqual(["b/doc", "z/doc"]);
    expect(statements.filter((s) => s.sql.includes("INSERT INTO legislation_sections")).map((s) => s.args[1]))
      .toEqual(["b/doc", "z/doc"]);

    expect(result).toEqual({
      ingested: 2,
      sectionsTotal: 2,
      documents: [
        { id: "z/doc", title: "Z document", sectionsInserted: 1 },
        { id: "b/doc", title: "B document", sectionsInserted: 1 },
      ],
      skipped: [{ id: "a/doc", reviewedAt: REVIEWED_AT }],
    });
  });

  it("the scheduled upsert never names reviewed_at / review_hash, so an existing marker survives", async () => {
    const batch = vi.fn<(statements: Statement[]) => Promise<void>>(async () => undefined);
    await replaceLegislationDocuments(markedDb([], batch), [normalizeOne()], SCHEDULED);

    const upserts = batch.mock.calls[0][0].filter((s) => s.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].sql).not.toContain("reviewed_at");
    expect(upserts[0].sql).not.toContain("review_hash");
    expect(upserts[0].args).toHaveLength(12);
  });

  it("the proposal source is guarded the same way", async () => {
    const batch = vi.fn<(statements: Statement[]) => Promise<void>>(async () => undefined);
    const db = markedDb([{ id: "qld/act-1999-039", reviewed_at: REVIEWED_AT }], batch);

    const result = await replaceLegislationDocuments(db, [normalizeOne()], { source: "proposal" });

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
    expect(result).toEqual({
      ingested: 0,
      sectionsTotal: 0,
      documents: [],
      skipped: [{ id: "qld/act-1999-039", reviewedAt: REVIEWED_AT }],
    });
  });

  it("normalizes the stored reviewed_at to ISO-8601 UTC for the skip report", async () => {
    const db = markedDb([
      { id: "qld/act-1999-039", reviewed_at: "2026-09-20 11:02:03.123456+10" },
    ]);
    const result = await replaceLegislationDocuments(db, [normalizeOne()], SCHEDULED);
    expect(result.skipped).toEqual([{ id: "qld/act-1999-039", reviewedAt: "2026-09-20T01:02:03.123Z" }]);
  });

  it("a reviewed payload for the same id replaces the sections and re-stamps the marker without a pre-select", async () => {
    const batch = vi.fn<(statements: Statement[]) => Promise<void>>(async () => undefined);
    const db = markedDb([{ id: "a/doc", reviewed_at: REVIEWED_AT }], batch);
    const [reviewedDocument] = normalizeLegislationDocuments([
      document({ id: "a/doc", title: "Planning Act 2016", sections: [{ sectionId: "s 1", content: "reviewed text" }] }),
    ]);

    const result = await replaceLegislationDocuments(db, [reviewedDocument], REVIEWED);

    expect(db.execute).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0][0];
    const upserts = statements.filter((s) => s.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].sql).toContain("reviewed_at, review_hash");
    expect(upserts[0].sql).toContain("NOW(), ?)");
    expect(upserts[0].sql).toContain("reviewed_at = NOW()");
    expect(upserts[0].sql).toContain("review_hash = excluded.review_hash");
    expect(upserts[0].args).toHaveLength(13);
    expect(upserts[0].args[12]).toBe(reviewHashForDocument(reviewedDocument));
    expect(upserts[0].args[12]).toMatch(/^[0-9a-f]{64}$/);
    expect(statements.filter((s) => s.sql.includes("DELETE FROM legislation_sections")).map((s) => s.args[0]))
      .toEqual(["a/doc"]);
    const sectionInserts = statements.filter((s) => s.sql.includes("INSERT INTO legislation_sections"));
    expect(sectionInserts).toHaveLength(1);
    expect(sectionInserts[0].args[4]).toBe("reviewed text");
    expect(result).toEqual({
      ingested: 1,
      sectionsTotal: 1,
      documents: [{ id: "a/doc", title: "Planning Act 2016", sectionsInserted: 1 }],
      skipped: [],
    });
  });

  it("review_hash is the canonical legislation-payload-v1 digest of the normalized document", () => {
    const explicit = normalizeOne({ relatedDocs: ["qld/reg-2020-002"] });
    expect(reviewHashForDocument(explicit)).toBe(hashCanonicalLegislation({
      ...explicit,
      relatedDocs: explicit.relatedDocs ?? [],
    }));
    // Stable across raw-input differences that normalize away …
    expect(reviewHashForDocument(normalizeOne({ title: "  Judicial Review Act 1991  " })))
      .toBe(reviewHashForDocument(normalizeOne()));
    // … and sensitive to reviewed content.
    expect(reviewHashForDocument(normalizeOne({ sections: [{ sectionId: "s 1", content: "Text." }] })))
      .not.toBe(reviewHashForDocument(normalizeOne()));
    // Omitted relatedDocs (preserve) is a different reviewed payload from an explicit clear.
    expect(reviewHashForDocument(normalizeOne())).not.toBe(reviewHashForDocument(normalizeOne({ relatedDocs: [] })));
  });
});
