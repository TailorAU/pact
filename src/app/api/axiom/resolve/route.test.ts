/**
 * pact#28 ask-4 — tests for GET /api/axiom/resolve (deterministic
 * resolve-by-citation).
 *
 * Contract under test:
 *   - exact-title-first resolution against legislation_docs, THEN topics;
 *   - NEVER a fuzzy guess — anything below exact/near-exact is a 404 miss;
 *   - same-title multi-jurisdiction hits without a jurisdiction
 *     parenthetical are a 404 `citation_ambiguous` miss, not a guess;
 *   - `s 42` resolves to the chunk whose CONTENT contains the section
 *     marker when rows are content chunks (sectionId "chunk-N");
 *     unresolvable sections yield sectionRef: null without failing the doc.
 *
 * DB call order in the route (drives the mock sequencing):
 *   1. legislation_docs candidates (title-prefix LIKE)
 *   2. topics candidates            (only when no legislation winner)
 *   3. exact section_id lookup      (only when doc resolved + section asked)
 *   4. chunk-content candidates     (only when 3 found nothing)
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

import { GET } from "./route";

function callGet(citation: string | null) {
  const qs = citation === null ? "" : `?citation=${encodeURIComponent(citation)}`;
  return GET(new Request(`http://localhost/api/axiom/resolve${qs}`) as never);
}

function rows(r: Record<string, unknown>[]): DbResult {
  return { rows: r as never[] };
}

const REG_2017 = {
  id: "qld/reg-2017-165",
  title: "Coal Mining Safety and Health Regulation 2017",
  short_title: "CMSH Regulation",
  jurisdiction: "AU-QLD",
  doc_type: "regulation",
  year: 2017,
  in_force_date: "2017-09-01",
  repealed_date: null,
};

const PRIVACY_ACT = {
  id: "cth/act-1988-119",
  title: "Privacy Act 1988",
  short_title: "Privacy Act",
  jurisdiction: "CTH",
  doc_type: "act",
  year: 1988,
  in_force_date: "1989-01-01",
  repealed_date: null,
};

beforeEach(() => {
  mockDb.execute.mockReset();
});

describe("GET /api/axiom/resolve — request validation", () => {
  it("400 when citation is missing", async () => {
    const res = await callGet(null);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/axiom/resolve — legislation resolution", () => {
  it("resolves an exact-title Regulation citation to the Regulation, not the Act", async () => {
    mockDb.execute.mockResolvedValueOnce(rows([REG_2017]));

    const res = await callGet("Coal Mining Safety and Health Regulation 2017");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resolved).toBe(true);
    expect(body.docId).toBe("qld/reg-2017-165");
    expect(body.docType).toBe("regulation");
    expect(body.matchTier).toBe("exact");
    expect(body.canonicalTitle).toBe("Coal Mining Safety and Health Regulation 2017");
    expect(body.verifiedRef).toBe("Coal Mining Safety and Health Regulation 2017 (Qld)");
    expect(body.inForce).toBe(true);
    expect(body.sectionRef).toBeNull();
    expect(body.source).toBe("legislation");
    // No topics / section queries were needed.
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("resolves 'Privacy Act 1988 (Cth) s 6' with the sectionRef from the chunk containing the marker", async () => {
    mockDb.execute
      // 1. legislation candidates
      .mockResolvedValueOnce(rows([PRIVACY_ACT]))
      // 2. exact section_id lookup — nothing (chunked doc)
      .mockResolvedValueOnce(rows([]))
      // 3. chunk-content candidates
      .mockResolvedValueOnce(
        rows([
          { section_id: "chunk-1", content: "An Act to make provision to protect the privacy of individuals" },
          { section_id: "chunk-2", content: "Part II—Interpretation\n6 Interpretation\nIn this Act, unless the contrary intention appears" },
        ])
      );

    const res = await callGet("Privacy Act 1988 (Cth) s 6");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resolved).toBe(true);
    expect(body.docId).toBe("cth/act-1988-119");
    expect(body.sectionRef).toBe("chunk-2");
    expect(body.verifiedRef).toBe("Privacy Act 1988 (Cth) s 6");
    expect(body.inForce).toBe(true);
  });

  it("keeps the doc resolution and returns sectionRef null when the section marker is not found", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([PRIVACY_ACT]))
      .mockResolvedValueOnce(rows([])) // exact section_id — miss
      .mockResolvedValueOnce(rows([])); // chunk candidates — miss

    const res = await callGet("Privacy Act 1988 (Cth) s 999");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resolved).toBe(true);
    expect(body.sectionRef).toBeNull();
    // verifiedRef must NOT claim the unverified section.
    expect(body.verifiedRef).toBe("Privacy Act 1988 (Cth)");
  });

  it("resolves an exact section_id when the ingest stored real section ids", async () => {
    mockDb.execute
      .mockResolvedValueOnce(
        rows([
          {
            id: "qld/act-2011-018",
            title: "Work Health and Safety Act 2011",
            short_title: "WHS Act",
            jurisdiction: "AU-QLD",
            doc_type: "act",
            year: 2011,
            in_force_date: "2012-01-01",
            repealed_date: null,
          },
        ])
      )
      .mockResolvedValueOnce(rows([{ section_id: "s 19" }]));

    const res = await callGet("Work Health and Safety Act 2011 (Qld) s 19");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sectionRef).toBe("s 19");
    expect(body.verifiedRef).toBe("Work Health and Safety Act 2011 (Qld) s 19");
    // Only two DB calls — the chunk fallback never ran.
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  // ── #4461: Regulation pinpoints resolve against "r N" section ids ──────
  // Live prod shape (probed 2026-07-26): qld/reg-2017-165 stores its rows
  // as section_id "r 3" / "r 89" / "r 108" …, so a consumer citing
  // "… (Qld) s 42" previously got sectionRef: null even though the row
  // existed under the regulation prefix.
  it("resolves a Regulation 's N' citation against the stored 'r N' section id", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([{ ...REG_2017, title: "Coal Mining Safety and Health Regulation 2017 (Qld)" }]))
      .mockResolvedValueOnce(rows([{ section_id: "r 89" }]));

    const res = await callGet("Coal Mining Safety and Health Regulation 2017 (Qld) s 89");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sectionRef).toBe("r 89");
    // verifiedRef echoes the unit the RESOLVED row uses.
    expect(body.verifiedRef).toBe("Coal Mining Safety and Health Regulation 2017 (Qld) r 89");
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it("resolves an explicit 'r N' Regulation citation (unit written as cited)", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([{ ...REG_2017, title: "Coal Mining Safety and Health Regulation 2017 (Qld)" }]))
      .mockResolvedValueOnce(rows([{ section_id: "r 42" }]));

    const res = await callGet("Coal Mining Safety and Health Regulation 2017 (Qld) r 42");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docId).toBe("qld/reg-2017-165");
    expect(body.sectionRef).toBe("r 42");
    expect(body.verifiedRef).toBe("Coal Mining Safety and Health Regulation 2017 (Qld) r 42");
  });

  it("the exact-section lookup asks for every conventional unit prefix", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([{ ...REG_2017, title: "Coal Mining Safety and Health Regulation 2017 (Qld)" }]))
      .mockResolvedValueOnce(rows([{ section_id: "r 42" }]));

    await callGet("Coal Mining Safety and Health Regulation 2017 (Qld) s 42");
    const secCall = mockDb.execute.mock.calls[1][0] as { sql: string; args: unknown[] };
    expect(secCall.args).toContain("r 42");
    expect(secCall.args).toContain("s 42");
    expect(secCall.args).toContain("42");
  });

  it("a bare Regulation citation is unaffected — the year is not a pinpoint", async () => {
    mockDb.execute.mockResolvedValueOnce(rows([REG_2017]));

    const res = await callGet("Coal Mining Safety and Health Regulation 2017");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docId).toBe("qld/reg-2017-165");
    expect(body.sectionRef).toBeNull();
    expect(body.verifiedRef).toBe("Coal Mining Safety and Health Regulation 2017 (Qld)");
    // Only the doc query ran — no section lookup was triggered by the year.
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("does not double the jurisdiction when the ingested title already carries it (live prod shape)", async () => {
    mockDb.execute
      .mockResolvedValueOnce(
        rows([
          {
            id: "qld/act-2011-018",
            title: "Work Health and Safety Act 2011 (Qld)",
            short_title: "WHS Act",
            jurisdiction: "AU-QLD",
            doc_type: "act",
            year: 2011,
            in_force_date: "2012-01-01",
            repealed_date: null,
          },
        ])
      )
      .mockResolvedValueOnce(rows([]));

    const res = await callGet("Work Health and Safety Act 2011 (Qld)");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resolved).toBe(true);
    expect(body.verifiedRef).toBe("Work Health and Safety Act 2011 (Qld)");
  });

  it("NEVER returns a fuzzy guess: a non-prefix partial citation misses even when SQL returned a candidate", async () => {
    mockDb.execute
      // Legislation candidates: pretend the LIKE returned the Regulation for
      // a citation that is NOT an exact/near-exact title match.
      .mockResolvedValueOnce(rows([REG_2017]))
      // Topics — nothing.
      .mockResolvedValueOnce(rows([]));

    const res = await callGet("Coal Mining Regulation 2017");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resolved).toBe(false);
    expect(body.error).toBe("citation_not_resolved");
  });

  it("404 citation_ambiguous for same-title instruments across jurisdictions with no parenthetical", async () => {
    const whs = (jurisdiction: string, id: string) => ({
      id,
      title: "Work Health and Safety Act 2011",
      short_title: "WHS Act",
      jurisdiction,
      doc_type: "act",
      year: 2011,
      in_force_date: "2012-01-01",
      repealed_date: null,
    });
    mockDb.execute.mockResolvedValueOnce(
      rows([whs("CTH", "cth/act-2011-137"), whs("AU-SA", "sa/act-2012-040"), whs("AU-TAS", "tas/act-2012-001")])
    );

    const res = await callGet("Work Health and Safety Act 2011");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      resolved: boolean;
      error: string;
      candidates: Array<{ docId: string; jurisdiction: string }>;
    };
    expect(body.error).toBe("citation_ambiguous");
    expect(body.candidates).toHaveLength(3);
  });

  it("the jurisdiction parenthetical disambiguates same-title instruments", async () => {
    const whs = (jurisdiction: string, id: string) => ({
      id,
      title: "Work Health and Safety Act 2011",
      short_title: "WHS Act",
      jurisdiction,
      doc_type: "act",
      year: 2011,
      in_force_date: "2012-01-01",
      repealed_date: null,
    });
    // SQL applies the jurisdiction filter too, but the JS guard must hold on
    // its own even if the mock returns all three.
    mockDb.execute.mockResolvedValueOnce(
      rows([whs("CTH", "cth/act-2011-137"), whs("AU-SA", "sa/act-2012-040"), whs("AU-TAS", "tas/act-2012-001")])
    );

    const res = await callGet("Work Health and Safety Act 2011 (Tas)");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docId).toBe("tas/act-2012-001");
    expect(body.verifiedRef).toBe("Work Health and Safety Act 2011 (Tas)");
  });

  it("marks repealed instruments inForce: false", async () => {
    mockDb.execute.mockResolvedValueOnce(
      rows([{ ...PRIVACY_ACT, id: "cth/act-old", title: "Old Act 1901", repealed_date: "1990-01-01" }])
    );
    const res = await callGet("Old Act 1901");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.inForce).toBe(false);
  });
});

describe("GET /api/axiom/resolve — topic resolution", () => {
  it("resolves a standards designation citation to the standards topic", async () => {
    mockDb.execute
      // 1. legislation — nothing
      .mockResolvedValueOnce(rows([]))
      // 2. topics
      .mockResolvedValueOnce(
        rows([
          {
            id: "t-4308",
            title:
              "AS/NZS 4308:2008 sets the procedures for specimen collection and the detection and quantitation of drugs of abuse in urine",
            tier: "institutional",
            status: "locked",
            jurisdiction: "AU",
            source_ref: "https://store.standards.org.au/product/as-nzs-4308-2008",
          },
        ])
      );

    const res = await callGet("AS/NZS 4308:2008");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resolved).toBe(true);
    expect(body.docId).toBe("topic:t-4308");
    expect(body.docType).toBe("topic");
    expect(body.sectionRef).toBeNull();
    expect(body.inForce).toBeNull();
    expect(body.verifiedRef).toBe("https://store.standards.org.au/product/as-nzs-4308-2008");
    expect(body.source).toBe("topic");
  });

  it("resolves a citation to a claim-sentence topic title via the near-exact prefix tier", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(
        rows([
          {
            id: "privacy-app",
            title:
              "Privacy Act 1988 (Cth) establishes 13 Australian Privacy Principles for handling personal information",
            tier: "institutional",
            status: "locked",
            jurisdiction: "AU",
            source_ref: "Privacy Act 1988 (Cth), Schedule 1",
          },
        ])
      );

    const res = await callGet("Privacy Act 1988");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docId).toBe("topic:privacy-app");
    expect(body.matchTier).toBe("near-exact");
  });

  it("skips topics that fail the title-tier verification and misses", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(
        rows([
          {
            id: "unrelated",
            title: "Something about coal mining safety generally",
            tier: "institutional",
            status: "locked",
            jurisdiction: "AU",
            source_ref: null,
          },
        ])
      );

    const res = await callGet("Coal Mining Safety and Health Regulation 2017");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("citation_not_resolved");
  });
});
