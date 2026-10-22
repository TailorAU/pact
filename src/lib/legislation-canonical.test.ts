import { describe, expect, it } from "vitest";
import {
  buildCanonicalLegislationState,
  canonicalLegislationFromPersistedRow,
  hashCanonicalLegislation,
  LEGISLATION_PAYLOAD_DIGEST_VERSION,
  normalizeCanonicalLegislation,
  serializeCanonicalLegislation,
  type CanonicalLegislationDocumentInput,
} from "./legislation-canonical";

const GOLDEN_INPUT: CanonicalLegislationDocumentInput = {
  id: "qld/act-2016-025",
  jurisdiction: "AU-QLD",
  type: "act",
  title: "Planning Act 2016",
  shortTitle: null,
  year: 2016,
  number: "25",
  inForceDate: "2017-07-03",
  lastAmendedDate: null,
  repealedDate: null,
  administeredBy: "Department of State Development",
  legislationUrl: "https://example.test/act",
  sections: [
    {
      sectionId: "s 2",
      title: "Definitions",
      content: "Meaning.",
      depth: 3,
      parentSection: "pt 1",
      order: 2,
      status: "in_force",
      amendedBy: null,
      crossReferences: ["s 3", "s 1"],
      notes: "note",
    },
    {
      sectionId: "s 1",
      title: null,
      content: "  exact\nbytes  ",
      depth: 2,
      parentSection: null,
      order: 1,
      status: "in_force",
      amendedBy: null,
      crossReferences: [],
      notes: null,
    },
  ],
  relatedDocs: ["qld/reg-b", "qld/reg-a"],
};

const GOLDEN_PREIMAGE = [
  '{"administeredBy":"Department of State Development","id":"qld/act-2016-025",',
  '"inForceDate":"2017-07-03","jurisdiction":"AU-QLD","lastAmendedDate":null,',
  '"legislationUrl":"https://example.test/act","number":"25",',
  '"relatedDocs":["qld/reg-a","qld/reg-b"],"repealedDate":null,"sections":[',
  '{"amendedBy":null,"content":"  exact\\nbytes  ","crossReferences":[],"depth":2,',
  '"notes":null,"order":1,"parentSection":null,"sectionId":"s 1",',
  '"status":"in_force","title":null},',
  '{"amendedBy":null,"content":"Meaning.","crossReferences":["s 1","s 3"],',
  '"depth":3,"notes":"note","order":2,"parentSection":"pt 1",',
  '"sectionId":"s 2","status":"in_force","title":"Definitions"}],',
  '"shortTitle":null,"title":"Planning Act 2016","type":"act","year":2016}',
].join("");

const GOLDEN_HASH = "b236329de6b1b202dd39c05ebb3c66220ca446d121ece72fbb260b55a5f4cdc7";

function copyGolden(): CanonicalLegislationDocumentInput {
  return structuredClone(GOLDEN_INPUT);
}

function persistedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "qld/act-2016-025",
    jurisdiction: "AU-QLD",
    doc_type: "act",
    title: "Planning Act 2016",
    short_title: null,
    year: 2016,
    number: "25",
    in_force_date: "2017-07-03",
    last_amended_date: null,
    repealed_date: null,
    administered_by: "Department of State Development",
    legislation_url: "https://example.test/act",
    created_at: "2026-01-01T00:00:00Z",
    sections: [
      {
        id: "internal-section-pk",
        docId: "qld/act-2016-025",
        topicId: "generated-topic-link",
        sectionId: "s 1",
        title: null,
        content: "  exact\nbytes  ",
        depth: 2,
        parentSection: null,
        order: 1,
        status: "in_force",
        amendedBy: null,
        crossReferences: "[]",
        notes: null,
      },
      {
        sectionId: "s 2",
        title: "Definitions",
        content: "Meaning.",
        depth: 3,
        parentSection: "pt 1",
        order: 2,
        status: "in_force",
        amendedBy: null,
        crossReferences: '["s 3","s 1"]',
        notes: "note",
      },
    ],
    related_docs: ["qld/reg-b", "qld/reg-a"],
    relation_created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type PersistedMutation = (row: Record<string, unknown>) => void;

const INVALID_PERSISTED_STATES: Array<[string, PersistedMutation]> = [
  ["blank required document field", (row) => { row.title = "  "; }],
  ["blank required section field", (row) => {
    (row.sections as Array<Record<string, unknown>>)[0].sectionId = " ";
  }],
  ["invalid document enum", (row) => { row.doc_type = "bill"; }],
  ["invalid section enum", (row) => {
    (row.sections as Array<Record<string, unknown>>)[0].status = "draft";
  }],
  ["invalid ISO date", (row) => { row.in_force_date = "2024-02-30"; }],
  ["invalid URL", (row) => { row.legislation_url = "file:///etc/passwd"; }],
  ["empty section set", (row) => { row.sections = []; }],
  ["duplicate normalized section IDs", (row) => {
    (row.sections as Array<Record<string, unknown>>)[1].sectionId = " s 1 ";
  }],
  ["duplicate section order", (row) => {
    (row.sections as Array<Record<string, unknown>>)[1].order = 1;
  }],
  ["blank cross-reference", (row) => {
    (row.sections as Array<Record<string, unknown>>)[1].crossReferences = '[" "]';
  }],
  ["duplicate normalized cross-references", (row) => {
    (row.sections as Array<Record<string, unknown>>)[1].crossReferences = '["s 1"," s 1 "]';
  }],
  ["blank related document", (row) => { row.related_docs = [" "]; }],
  ["duplicate normalized relations", (row) => {
    row.related_docs = ["qld/reg-a", " qld/reg-a "];
  }],
];

describe("legislation canonical payload v1", () => {
  it("freezes a cross-language compact JSON preimage and SHA-256 vector", () => {
    expect(serializeCanonicalLegislation(GOLDEN_INPUT)).toBe(GOLDEN_PREIMAGE);
    expect(hashCanonicalLegislation(GOLDEN_INPUT)).toBe(GOLDEN_HASH);
    expect(GOLDEN_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(LEGISLATION_PAYLOAD_DIGEST_VERSION).toBe("legislation-payload-v1");
  });

  it("projects shared normalized input exactly like the replacement contract", () => {
    const normalized = normalizeCanonicalLegislation(GOLDEN_INPUT);
    expect(normalized).toMatchObject({
      id: "qld/act-2016-025",
      jurisdiction: "AU-QLD",
      type: "act",
      title: "Planning Act 2016",
      shortTitle: null,
      number: "25",
      relatedDocs: ["qld/reg-a", "qld/reg-b"],
    });
    expect(normalized.sections.map((section) => section.sectionId)).toEqual(["s 1", "s 2"]);
    expect(normalized.sections[0]).toMatchObject({
      title: null,
      depth: 2,
      parentSection: null,
      status: "in_force",
      amendedBy: null,
      crossReferences: [],
      notes: null,
    });
    expect(normalized.sections[0].content).toBe("  exact\nbytes  ");
    expect(normalized.sections[1].crossReferences).toEqual(["s 1", "s 3"]);
  });

  it("is independent of valid input collection order and rejects duplicate section order", () => {
    const reordered = copyGolden();
    reordered.sections = [...reordered.sections].reverse();
    reordered.relatedDocs = [...reordered.relatedDocs].reverse();
    const sectionWithReferences = reordered.sections.find(
      (section) => section.sectionId.trim() === "s 2",
    );
    if (!sectionWithReferences) throw new Error("golden section missing");
    sectionWithReferences.crossReferences = ["s 1", "s 3"];
    expect(hashCanonicalLegislation(reordered)).toBe(GOLDEN_HASH);

    const tied = copyGolden();
    tied.sections = tied.sections.map((section) => ({ ...section, order: 7 })).reverse();
    expect(() => normalizeCanonicalLegislation(tied)).toThrow(
      "Legislation payload validation failed",
    );
  });

  it("uses Unicode code-point ordering across the BMP boundary without ASCII escaping", () => {
    const unicode = copyGolden();
    unicode.title = "Café 😀";
    unicode.relatedDocs = ["doc/\u{10000}", "doc/\uE000", "doc/z"];
    const normalized = normalizeCanonicalLegislation(unicode);
    expect(normalized.relatedDocs).toEqual(["doc/z", "doc/\uE000", "doc/\u{10000}"]);
    expect(serializeCanonicalLegislation(unicode)).toContain('"title":"Café 😀"');
  });

  it("cannot hash omitted relatedDocs as an explicit clear", () => {
    const explicitClear = copyGolden();
    explicitClear.relatedDocs = [];
    expect(hashCanonicalLegislation(explicitClear)).toMatch(/^[0-9a-f]{64}$/);

    const omitted = copyGolden() as Partial<CanonicalLegislationDocumentInput>;
    delete omitted.relatedDocs;
    expect(() => hashCanonicalLegislation(
      omitted as CanonicalLegislationDocumentInput,
    )).toThrow("Canonical legislation state requires explicit relatedDocs");
  });

  it.each(["local_law", "planning_scheme"] as const)(
    "preserves the live %s document type in the canonical projection",
    (type) => {
      const localInstrument = copyGolden();
      localInstrument.type = type;
      expect(normalizeCanonicalLegislation(localInstrument).type).toBe(type);
      expect(hashCanonicalLegislation(localInstrument)).not.toBe(GOLDEN_HASH);
    },
  );

  it("trims but otherwise preserves canonical ID case and punctuation", () => {
    const localInstrument = copyGolden();
    localInstrument.id = " QLD/Local-Law:2026-(No.7) ";
    expect(normalizeCanonicalLegislation(localInstrument).id).toBe(
      "QLD/Local-Law:2026-(No.7)",
    );
  });

  it.each([
    ["id", (doc: CanonicalLegislationDocumentInput) => { doc.id = "qld/act-other"; }],
    ["jurisdiction", (doc: CanonicalLegislationDocumentInput) => { doc.jurisdiction = "NSW"; }],
    ["type", (doc: CanonicalLegislationDocumentInput) => { doc.type = "regulation"; }],
    ["title", (doc: CanonicalLegislationDocumentInput) => { doc.title = "Renamed Act"; }],
    ["shortTitle", (doc: CanonicalLegislationDocumentInput) => { doc.shortTitle = "Planning Act"; }],
    ["year", (doc: CanonicalLegislationDocumentInput) => { doc.year = 2017; }],
    ["number", (doc: CanonicalLegislationDocumentInput) => { doc.number = "26"; }],
    ["inForceDate", (doc: CanonicalLegislationDocumentInput) => { doc.inForceDate = "2017-07-04"; }],
    ["lastAmendedDate", (doc: CanonicalLegislationDocumentInput) => { doc.lastAmendedDate = "2026-01-01"; }],
    ["repealedDate", (doc: CanonicalLegislationDocumentInput) => { doc.repealedDate = "2027-01-01"; }],
    ["administeredBy", (doc: CanonicalLegislationDocumentInput) => { doc.administeredBy = "Another agency"; }],
    ["legislationUrl", (doc: CanonicalLegislationDocumentInput) => { doc.legislationUrl = "https://example.test/other"; }],
    ["relatedDocs", (doc: CanonicalLegislationDocumentInput) => { doc.relatedDocs = ["qld/reg-c"]; }],
  ])("changes the digest when document field %s changes", (_field, mutate) => {
    const changed = copyGolden();
    mutate(changed);
    expect(hashCanonicalLegislation(changed)).not.toBe(GOLDEN_HASH);
  });

  it.each([
    ["sectionId", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].sectionId = "s 20"; }],
    ["title", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].title = "Changed"; }],
    ["content", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].content += " "; }],
    ["depth", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].depth = 4; }],
    ["parentSection", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].parentSection = "pt 9"; }],
    ["order", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].order = 99; }],
    ["status", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].status = "repealed"; }],
    ["amendedBy", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].amendedBy = "Amending Act"; }],
    ["crossReferences", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].crossReferences = ["s 99"]; }],
    ["notes", (doc: CanonicalLegislationDocumentInput) => { doc.sections[0].notes = "Changed note"; }],
  ])("changes the digest when section field %s changes", (_field, mutate) => {
    const changed = copyGolden();
    mutate(changed);
    expect(hashCanonicalLegislation(changed)).not.toBe(GOLDEN_HASH);
  });

  it("changes the digest when a section is added or removed", () => {
    const added = copyGolden();
    added.sections = [...added.sections, {
      sectionId: "s 3",
      title: null,
      content: "New section",
      depth: 2,
      parentSection: null,
      order: 3,
      status: "in_force",
      amendedBy: null,
      crossReferences: [],
      notes: null,
    }];
    const removed = copyGolden();
    removed.sections = removed.sections.slice(1);
    expect(hashCanonicalLegislation(added)).not.toBe(GOLDEN_HASH);
    expect(hashCanonicalLegislation(removed)).not.toBe(GOLDEN_HASH);
  });
});

describe("persisted legislation projection", () => {
  it("maps every payload-controlled field and ignores generated/audit columns", () => {
    const first = buildCanonicalLegislationState(persistedRow());
    const generatedOnlyChange = buildCanonicalLegislationState(persistedRow({
      created_at: "2099-01-01T00:00:00Z",
      internal_id: "different-generated-value",
      relation_created_at: "2099-01-01T00:00:00Z",
    }));

    expect(first.document).toEqual(normalizeCanonicalLegislation(GOLDEN_INPUT));
    expect(first).toMatchObject({
      sectionCount: 2,
      digestVersion: "legislation-payload-v1",
      payloadHash: GOLDEN_HASH,
    });
    expect(generatedOnlyChange.payloadHash).toBe(first.payloadHash);
  });

  it("accepts PostgreSQL JSON aggregates as decoded values or JSON text", () => {
    const row = persistedRow({
      sections: JSON.stringify(persistedRow().sections),
      related_docs: '["qld/reg-b","qld/reg-a"]',
    });
    expect(canonicalLegislationFromPersistedRow(row)).toEqual(
      normalizeCanonicalLegislation(GOLDEN_INPUT),
    );
  });

  it("fails closed on malformed persisted JSON instead of producing a false exact hash", () => {
    const malformed = persistedRow();
    const sections = malformed.sections as Array<Record<string, unknown>>;
    sections[0].crossReferences = "not-json";
    expect(() => canonicalLegislationFromPersistedRow(malformed)).toThrow(
      "Invalid persisted legislation field",
    );
  });

  it.each(INVALID_PERSISTED_STATES)(
    "fails closed on persisted state with %s",
    (_case, mutate) => {
      const row = persistedRow();
      mutate(row);
      expect(() => canonicalLegislationFromPersistedRow(row)).toThrow(
        "Legislation payload validation failed",
      );
    },
  );
});
