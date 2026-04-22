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
  autoMergeExpired: async () => {},
}));

// The search route debits anonymous callers as a no-op and paid callers
// via wallet. Bypass the debit so tests focus on ranking.
vi.mock("@/lib/wallet-debit", () => ({
  debitIfAuthenticated: async () => ({ ok: true }),
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
});

describe("GET /api/axiom/legislation/search — #1250 ranking regression", () => {
  it("returns 400 when q is missing", async () => {
    const res = await callGet("");
    expect(res.status).toBe(400);
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
