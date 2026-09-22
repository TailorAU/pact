/**
 * #1250 — Regression tests for GET /api/axiom/legislation/search.
 *
 * Covers issue #745: the public legislation search returned off-domain
 * results at the top for `?q=construction` (Commonwealth "non-construction
 * procurement" topic and NSW Environmental Planning Act ahead of QLD
 * construction acts).
 *
 * Ranker invariants tested:
 *   1. `non-construction` in a topic title must NOT receive the title-match
 *      boost for the keyword `construction` (negation guard).
 *   2. Topics no longer get an unjustified +5 title boost over legislation
 *      (+3) — both sources score title matches at parity.
 *   3. Bare queries (no `jurisdiction` / no `preferJurisdiction`) apply a
 *      mild AU-root bias so an AU legislation hit outranks an equivalent
 *      non-AU topic on an AU legislation API.
 *   4. `preferJurisdiction=AU-QLD` lifts QLD-rooted hits above other
 *      AU-rooted hits in the relevance ordering.
 *
 * WS11 federation hardening tested:
 *   5. limit > 200 → 400 { error: "limit_too_high" }
 *   6. topic query timeout → base results + topicsFederated: false
 *   7. happy path (no timeout) → topicsFederated: true
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

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

vi.mock("@/lib/db", () => ({
  getDb: async () => mockDb as unknown as DbClient,
}));

// The search route debits anonymous callers as a no-op and paid callers
// via wallet. Bypass the debit so tests focus on ranking.
vi.mock("@/lib/wallet-debit", () => ({
  debitIfAuthenticated: async () => ({ ok: true }),
}));

// Silence logger output in tests; capture warn calls for timeout assertions.
const mockLogWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => ({
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: (...args: unknown[]) => mockLogWarn(...args),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

import { GET } from "./route";

// Helpers to build the two result shapes the route SELECTs.
function legislationRow(partial: {
  doc_id: string;
  doc_title: string;
  jurisdiction: string;
  section_id?: string;
  section_title?: string | null;
  content?: string;
  doc_type?: string;
  year?: number | null;
  short_title?: string | null;
}) {
  return {
    id: `sec:${partial.doc_id}:${partial.section_id ?? "s1"}`,
    doc_id: partial.doc_id,
    section_id: partial.section_id ?? "s1",
    section_title: partial.section_title ?? null,
    content: partial.content ?? "",
    depth: 1,
    section_status: "in_force",
    cross_references: null,
    notes: null,
    doc_title: partial.doc_title,
    jurisdiction: partial.jurisdiction,
    doc_type: partial.doc_type ?? "act",
    year: partial.year ?? 2020,
    short_title: partial.short_title ?? null,
    administered_by: null,
  };
}

function topicRow(partial: {
  id: string;
  title: string;
  canonical_claim?: string;
  content?: string;
  jurisdiction?: string | null;
  tier?: string;
  status?: string;
  source_ref?: string | null;
}) {
  return {
    id: partial.id,
    title: partial.title,
    content: partial.content ?? "",
    canonical_claim: partial.canonical_claim ?? null,
    tier: partial.tier ?? "institutional",
    status: partial.status ?? "locked",
    jurisdiction: partial.jurisdiction ?? null,
    authority: null,
    source_ref: partial.source_ref ?? null,
  };
}

function callGet(search: string) {
  return GET(new Request(`http://localhost/api/axiom/legislation/search?${search}`) as never);
}

// Order of mockDb.execute calls in the route:
//   1. COUNT(*) legislation_sections (returns `total`)
//   2. SELECT legislation_sections rows
//   3. SELECT topics rows (skipped when docType filter excludes topics)
function prime(countTotal: number, legRows: ReturnType<typeof legislationRow>[], topicRows: ReturnType<typeof topicRow>[]) {
  mockDb.execute
    .mockResolvedValueOnce({ rows: [{ total: countTotal }] as never[] } as DbResult)
    .mockResolvedValueOnce({ rows: legRows as never[] } as DbResult)
    .mockResolvedValueOnce({ rows: topicRows as never[] } as DbResult);
}

beforeEach(() => {
  mockDb.execute.mockReset();
  mockLogWarn.mockReset();
});

describe("GET /api/axiom/legislation/search — #1250 ranking regression", () => {
  it("returns 400 when q is missing", async () => {
    const res = await callGet("");
    expect(res.status).toBe(400);
  });

  // tailor-group#7 — the q length cap bounds the tokeniser's work
  // (CodeQL js/polynomial-redos in lib/legislation-ranking.ts).
  it("returns 400 when q exceeds 512 characters", async () => {
    const res = await callGet(`q=${"a".repeat(513)}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Query parameter q exceeds 512 characters");
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("accepts q of exactly 512 characters", async () => {
    prime(0, [], []);
    const res = await callGet(`q=${"a".repeat(512)}`);
    expect(res.status).toBe(200);
  });

  it("issue #745 repro: `q=construction` does NOT rank a `non-construction` topic #1", async () => {
    // Simulate the Run 10 dataset: a QLD Act with 'construction' in title,
    // a NSW Act that mentions construction in content, and the CPR topic
    // whose title contains 'non-construction'.
    const qldAct = legislationRow({
      doc_id: "qbcc-act",
      doc_title: "Queensland Building and Construction Commission Act 1991",
      jurisdiction: "AU-QLD",
      section_title: "Part 1 — Preliminary",
      content: "This Act regulates construction in Queensland.",
      short_title: "QBCC Act",
    });
    const nswAct = legislationRow({
      doc_id: "nsw-epa",
      doc_title: "Environmental Planning and Assessment Act 1979",
      jurisdiction: "AU-NSW",
      section_title: "Development consent",
      // Content mentions construction many times to simulate the issue
      // where NSW Act outscored QLD on raw content-occurrence counts.
      content: "construction construction construction planning development",
      short_title: "NSW EP&A Act",
    });
    const cprTopic = topicRow({
      id: "cpr-threshold",
      title: "CPR threshold — $80k open tender for non-construction goods / services at or above $80k",
      canonical_claim: "Commonwealth Procurement Rules set a $80,000 threshold for non-construction procurement.",
      jurisdiction: "AU",
      tier: "institutional",
      status: "locked",
    });

    prime(2, [qldAct, nswAct], [cprTopic]);

    const res = await callGet("q=construction");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number; docTitle: string; jurisdiction: string | null }>;
    };

    expect(body.results.length).toBe(3);

    // Primary invariant: the CPR `non-construction` topic must NOT be #1.
    const topHit = body.results[0];
    expect(topHit.docId).not.toBe("topic:cpr-threshold");

    // The QLD construction Act must outrank the CPR topic (title-match
    // parity + AU-QLD beats AU-root via default AU bias ties).
    const qldScore = body.results.find((r) => r.docId === "qbcc-act")!.relevanceScore;
    const cprScore = body.results.find((r) => r.docId === "topic:cpr-threshold")!.relevanceScore;
    expect(qldScore).toBeGreaterThan(cprScore);
  });

  it("topic `non-construction` title does NOT receive the +3 title boost for `construction`", async () => {
    // Build a topic whose ONLY keyword-bearing text is `non-construction`
    // in the title. Under the old ranker it scored +5 (title boost). Under
    // #1250 it scores 0 from that keyword (negation guard) — only the
    // jurisdiction + authority bonuses remain.
    const cprTopic = topicRow({
      id: "cpr-topic",
      title: "CPR threshold — non-construction procurement",
      canonical_claim: "Unrelated canonical claim text.",
      jurisdiction: "AU",
      tier: "institutional",
      status: "locked",
    });
    prime(0, [], [cprTopic]);

    const res = await callGet("q=construction");
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number }>;
    };

    const hit = body.results.find((r) => r.docId === "topic:cpr-topic")!;
    // Expected: 0 (title boost suppressed) + 1 (AU-root default bias) +
    // 1 (institutional-locked authority bonus) = 2. Critically, < 3 — the
    // value the old ranker would have produced from title alone.
    expect(hit.relevanceScore).toBeLessThan(3);
  });

  it("`preferJurisdiction=AU-QLD` lifts QLD hits above other AU hits (equivalent keyword profile)", async () => {
    // Build two hits with identical keyword profiles — same title pattern,
    // same content hit count. The only differentiator is jurisdiction.
    // Under `preferJurisdiction=AU-QLD` the QLD hit must win.
    const qldAct = legislationRow({
      doc_id: "qld-planning",
      doc_title: "Planning Act 2016",
      jurisdiction: "AU-QLD",
      section_title: "Construction works",
      content: "construction works require development approval.",
    });
    const nswAct = legislationRow({
      doc_id: "nsw-epa",
      doc_title: "Environmental Planning and Assessment Act 1979",
      jurisdiction: "AU-NSW",
      section_title: "Construction works",
      content: "construction works require development consent.",
    });
    prime(2, [qldAct, nswAct], []);

    const res = await callGet("q=construction&preferJurisdiction=AU-QLD");
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number; jurisdiction: string | null }>;
      ranking: { preferJurisdiction: string | null; defaultAuBias: boolean };
    };

    expect(body.ranking.preferJurisdiction).toBe("AU-QLD");
    expect(body.ranking.defaultAuBias).toBe(false);

    const qldScore = body.results.find((r) => r.docId === "qld-planning")!.relevanceScore;
    const nswScore = body.results.find((r) => r.docId === "nsw-epa")!.relevanceScore;
    // QLD: +3 section_title match + 1 content + 2 prefer-AU-QLD exact = 6
    // NSW: +3 section_title match + 1 content + 1 prefer-AU-QLD parent AU = 5
    expect(qldScore).toBeGreaterThan(nswScore);
  });

  it("default AU-root bias applies on bare queries (equivalent keyword profiles)", async () => {
    // Two results with equivalent keyword profiles (identical title + 1
    // content hit). The only differentiator is jurisdiction. Under a bare
    // `?q=mining` query (no filter, no prefer), the AU-rooted hit wins
    // via the default AU bias signal. Non-AU hits still appear — they're
    // just ranked lower.
    const auLeg = legislationRow({
      doc_id: "au-wh-s",
      doc_title: "Mining Safety Act",
      jurisdiction: "AU-QLD",
      section_title: null,
      content: "mining duties apply.",
    });
    const usTopic = topicRow({
      id: "us-smara",
      title: "Mining Safety Standard",
      canonical_claim: "mining reclamation standards apply.",
      jurisdiction: "US-CA",
      tier: "proposed", // drop authority bonus so this is a pure jurisdiction test
      status: "open",
    });
    prime(1, [auLeg], [usTopic]);

    const res = await callGet("q=mining");
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number; jurisdiction: string | null }>;
      ranking: { defaultAuBias: boolean };
    };

    expect(body.ranking.defaultAuBias).toBe(true);
    const auScore = body.results.find((r) => r.docId === "au-wh-s")!.relevanceScore;
    const usScore = body.results.find((r) => r.docId === "topic:us-smara")!.relevanceScore;
    // AU: +3 doc_title + 1 content + 1 AU-root = 5
    // US: +3 title + 1 content = 4
    expect(auScore).toBeGreaterThan(usScore);
  });

  it("keeps backward-compatible response shape (results/query/keywords/total/sources/_links)", async () => {
    prime(0, [], []);
    const res = await callGet("q=mining");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("query", "mining");
    expect(body).toHaveProperty("keywords");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("sources");
    expect(body).toHaveProperty("_links");
    expect(body).toHaveProperty("free", true);
  });
});

// ── WS11 — federation hardening tests ───────────────────────────────────────
describe("GET /api/axiom/legislation/search — WS11 federation hardening", () => {
  it("limit > 200 returns 400 with error: limit_too_high", async () => {
    // No DB mock needed — the limit check happens before any DB call.
    const res = await callGet("q=building&limit=201");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("limit_too_high");
  });

  it("topic query timeout returns base legislation results with topicsFederated: false", async () => {
    // Prime: legislation COUNT + rows succeed immediately; topics query
    // is replaced by a Promise that never resolves within the route's
    // 5s timeout. We achieve this by making the third mockDb.execute call
    // return a promise that resolves only after 10s — well past the 5s
    // race deadline baked into the route.
    const legRow = legislationRow({
      doc_id: "qld-wa",
      doc_title: "Work Health and Safety Act 2011",
      jurisdiction: "AU-QLD",
      content: "safety duties apply to all workers.",
    });
    mockDb.execute
      // Call 1: COUNT(*)
      .mockResolvedValueOnce({ rows: [{ total: 1 }] as never[] } as DbResult)
      // Call 2: legislation_sections rows
      .mockResolvedValueOnce({ rows: [legRow] as never[] } as DbResult)
      // Call 3: topics — deliberately slow (10s > 5s route timeout)
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] as never[] } as DbResult), 10_000))
      );

    const res = await callGet("q=safety");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: unknown[];
      topicsFederated: boolean;
      sources: { legislation: number; topics: number };
    };

    // Base legislation result must be present
    expect(body.results.length).toBeGreaterThan(0);
    // topicsFederated must be false to signal the timeout
    expect(body.topicsFederated).toBe(false);
    // topics count must be zero
    expect(body.sources.topics).toBe(0);
    // warn log must have fired
    expect(mockLogWarn).toHaveBeenCalledOnce();
    const warnArg = mockLogWarn.mock.calls[0][0] as Record<string, unknown>;
    expect(warnArg.op).toBe("axiom.legislation.search.federation_timeout");
    expect(typeof warnArg.elapsedMs).toBe("number");
  }, 10_000); // vitest timeout: 10s to allow the slow mock to settle

  it("happy path returns topicsFederated: true when topics query completes in time", async () => {
    const legRow = legislationRow({
      doc_id: "qld-pa",
      doc_title: "Planning Act 2016",
      jurisdiction: "AU-QLD",
      content: "planning approval required.",
    });
    const tRow = topicRow({
      id: "planning-topic",
      title: "Planning policy",
      canonical_claim: "planning approval is required for development.",
      jurisdiction: "AU-QLD",
      tier: "institutional",
      status: "locked",
    });
    prime(1, [legRow], [tRow]);

    const res = await callGet("q=planning");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: unknown[];
      topicsFederated: boolean;
      sources: { legislation: number; topics: number };
    };

    expect(body.topicsFederated).toBe(true);
    expect(body.sources.topics).toBe(1);
    expect(body.sources.legislation).toBe(1);
    expect(body.results.length).toBe(2);
    // warn must NOT have fired
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});

// ── pact#28 ask-2 — designation-aware search + exact-title ranking ──────────
// Live repros observed 2026-07-13 on pact.tailor.au:
//   A. "AS/NZS 4308" tokenised to ["nzs","4308"] — designation lost, zero rows.
//   B. "Privacy Act 1988" ranked the QLD Coal Mining Safety and Health Act's
//      body-text mentions above the actual Privacy Act topic nodes.
//   C. "Coal Mining Safety and Health Regulation 2017" ranked the Act above
//      the Regulation (qld/reg-2017-165).
describe("GET /api/axiom/legislation/search — pact#28 designation + exact-title ranking", () => {
  it("repro A: `q=AS/NZS 4308` keeps the designation as a token and ranks the standards topic first", async () => {
    const standardsTopic = topicRow({
      id: "asnzs-4308",
      title:
        "AS/NZS 4308:2008 sets the procedures for specimen collection and the detection and quantitation of drugs of abuse in urine",
      canonical_claim:
        "AS/NZS 4308:2008 (Standards Australia / Standards New Zealand, current) is the recognised standard for workplace urine drug screening in Australia.",
      jurisdiction: "AU",
      tier: "institutional",
      status: "locked",
      source_ref: "https://store.standards.org.au/product/as-nzs-4308-2008",
    });
    // Decoy: a section whose content merely contains the number 4308.
    const decoy = legislationRow({
      doc_id: "qld-decoy",
      doc_title: "Transport Operations (Road Use Management) Act 1995",
      jurisdiction: "AU-QLD",
      content: "form 4308 must be lodged with the chief executive.",
    });
    prime(1, [decoy], [standardsTopic]);

    const res = await callGet(`q=${encodeURIComponent("AS/NZS 4308")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number }>;
      keywords: string[];
      ranking: { designations: string[] };
    };

    // The designation survives tokenisation…
    expect(body.keywords).toContain("as/nzs 4308");
    expect(body.ranking.designations).toEqual(["as/nzs 4308"]);
    // …and the standards topic outranks the stray numeric body match.
    expect(body.results[0].docId).toBe("topic:asnzs-4308");
  });

  it("repro B: `q=Privacy Act 1988` ranks Privacy Act title nodes above body-text mentions", async () => {
    // The QLD CMSHA chunk mentions "Privacy Act 1988" repeatedly in BODY text.
    const coalMiningChunk = legislationRow({
      doc_id: "qld/act-1999-039",
      doc_title: "Coal Mining Safety and Health Act 1999",
      jurisdiction: "AU-QLD",
      section_id: "chunk-12",
      content:
        "privacy act 1988 privacy act 1988 privacy act 1988 information sharing under the privacy act 1988 by the regulator",
    });
    // The actual Privacy Act legislation doc (exact title) …
    const privacyActSection = legislationRow({
      doc_id: "cth/act-1988-119",
      doc_title: "Privacy Act 1988",
      jurisdiction: "AU-CTH",
      section_id: "chunk-1",
      content: "an act to make provision to protect the privacy of individuals",
    });
    // … and a Privacy Act topic node (claim-sentence title → near-exact).
    const privacyTopic = topicRow({
      id: "privacy-app",
      title: "Privacy Act 1988 (Cth) establishes 13 Australian Privacy Principles for handling personal information",
      canonical_claim: "The Privacy Act 1988 (Cth) establishes the 13 Australian Privacy Principles.",
      jurisdiction: "AU",
      tier: "institutional",
      status: "locked",
    });
    prime(2, [coalMiningChunk, privacyActSection], [privacyTopic]);

    const res = await callGet(`q=${encodeURIComponent("Privacy Act 1988")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number }>;
    };

    // Exact-title legislation doc first, near-exact topic second, body-text
    // fuzzy hit last — a title match ALWAYS outranks body-text matches.
    expect(body.results[0].docId).toBe("cth/act-1988-119");
    expect(body.results[1].docId).toBe("topic:privacy-app");
    expect(body.results[2].docId).toBe("qld/act-1999-039");
  });

  it("repro C: `q=Coal Mining Safety and Health Regulation 2017` ranks the Regulation above the Act", async () => {
    // The Act's sections carry heavy keyword profiles (title hits for coal /
    // mining / safety / health + many content occurrences)…
    const actChunk = legislationRow({
      doc_id: "qld/act-1999-039",
      doc_title: "Coal Mining Safety and Health Act 1999",
      jurisdiction: "AU-QLD",
      section_id: "chunk-3",
      content:
        "coal mining safety and health regulation coal mining safety and health obligations at coal mines safety and health management system",
    });
    // …while the Regulation is the exact-title match.
    const regChunk = legislationRow({
      doc_id: "qld/reg-2017-165",
      doc_title: "Coal Mining Safety and Health Regulation 2017",
      jurisdiction: "AU-QLD",
      doc_type: "regulation",
      section_id: "chunk-1",
      content: "this regulation prescribes matters for the coal mining safety and health act",
    });
    prime(2, [actChunk, regChunk], []);

    const res = await callGet(`q=${encodeURIComponent("Coal Mining Safety and Health Regulation 2017")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ docId: string; relevanceScore: number }>;
    };

    expect(body.results[0].docId).toBe("qld/reg-2017-165");
    const regScore = body.results.find((r) => r.docId === "qld/reg-2017-165")!.relevanceScore;
    const actScore = body.results.find((r) => r.docId === "qld/act-1999-039")!.relevanceScore;
    expect(regScore).toBeGreaterThan(actScore);
  });

  it("exact-title fetch-window: the legislation SQL orders title-prefix rows first", async () => {
    // Guard the ORDER BY pre-pass — the second db.execute call (section rows)
    // must carry the title-first CASE and the lowercased query prefix param
    // so exact-title docs land inside the LIMIT window on large datasets.
    prime(0, [], []);
    await callGet(`q=${encodeURIComponent("Privacy Act 1988")}`);
    const sectionCall = mockDb.execute.mock.calls[1][0] as { sql: string; args: unknown[] };
    expect(sectionCall.sql).toContain("CASE WHEN LOWER(d.title) LIKE ? THEN 0 ELSE 1 END");
    expect(sectionCall.args).toContain("privacy act 1988%");
  });
});

// ── tailor-group#37 — parser-suffixed section ids are not citable pinpoints ─
// The parsers suffix a repeated heading's id ("s 308", "s 308 [2]", …) so an
// amending Act ingests whole. The suffix is a storage key: the route must
// serve such a row as an extract with the document-level sourceRef, never as
// `"<Act> s 308 [2]"`, while the bare first occurrence stays a pinpoint.
describe("GET /api/axiom/legislation/search — suffixed section ids (tailor-group#37)", () => {
  it("serves `s 308` as a pinpoint and `s 308 [2]` as an extract cited at document level", async () => {
    const doc = {
      doc_id: "cth/act-2026-082",
      doc_title: "Combatting Illicit Tobacco Act 2026 (Cth)",
      short_title: "Combatting Illicit Tobacco Act 2026",
      jurisdiction: "AU-CTH",
    };
    const first = legislationRow({
      ...doc,
      section_id: "s 308",
      content: "Subsection 308(1) is amended by omitting the words about tobacco.",
    });
    const second = legislationRow({
      ...doc,
      section_id: "s 308 [2]",
      content: "Subsection 308(2) is amended by inserting the words about tobacco.",
    });
    prime(2, [first, second], []);

    const res = await callGet("q=tobacco");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ sectionId: string; sectionKind: string; sourceRef: string }>;
    };

    expect(body.results).toHaveLength(2);
    const byId = Object.fromEntries(body.results.map((r) => [r.sectionId, r]));
    expect(byId["s 308"]).toMatchObject({
      sectionKind: "pinpoint",
      sourceRef: "Combatting Illicit Tobacco Act 2026 s 308",
    });
    expect(byId["s 308 [2]"]).toMatchObject({
      sectionKind: "extract",
      sourceRef: "Combatting Illicit Tobacco Act 2026",
    });
    for (const r of body.results) expect(r.sourceRef).not.toContain("[2]");
  });
});
