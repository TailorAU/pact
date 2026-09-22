/**
 * tailor-group#7 — the CTH Titles filter.
 *
 * `status` and `collection` are OData enums on api.prod.legislation.gov.au.
 * `collection eq 'Act' and status eq 'InForce'` answers 400 ("Could not find
 * a property named 'InForce'"), so every weekly sync fetched zero titles.
 * `status in ('InForce')` binds correctly in the conjunction.
 *
 * The first block pins the URL shape offline. The second runs against the
 * live API and is gated by CTH_LIVE=1 so CI never depends on a third party;
 * run it by hand as evidence when the parser changes.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../db";

vi.mock("../db", () => ({
  getDb: async () => ({}),
  // A two-method mock has no transaction(): the real helper runs fn on it directly.
  withTransaction: async <T,>(db: DbClient, fn: (tx: DbClient) => Promise<T>) => fn(db),
}));

import { normalizeLegislationDocuments } from "../legislation-ingest";
import { buildTitlesUrl, fetchInForceActs, parseActHtml, syncCth } from "./cth-parser";

describe("buildTitlesUrl", () => {
  const url = buildTitlesUrl(20, 10);
  const filter = decodeURIComponent(new URL(url).searchParams.get("$filter") ?? "");
  const orderby = decodeURIComponent(new URL(url).searchParams.get("$orderby") ?? "");

  it("uses the `in` form for the enum status, never `status eq`", () => {
    expect(filter).toBe("collection eq 'Act' and status in ('InForce')");
    expect(filter).not.toMatch(/status eq/);
  });

  it("pages newest-first with a stable tiebreak", () => {
    expect(orderby).toBe("year desc,number desc");
    expect(new URL(url).searchParams.get("$skip")).toBe("20");
    expect(new URL(url).searchParams.get("$top")).toBe("10");
  });

  it("selects the fields the sync reads", () => {
    const select = decodeURIComponent(new URL(url).searchParams.get("$select") ?? "");
    for (const f of ["id", "name", "year", "number", "status", "seriesType", "makingDate"]) {
      expect(select.split(",")).toContain(f);
    }
  });
});

describe("parseActHtml on current EPUB markup", () => {
  // Real document_1.html of C2026A00003 (Administrative Review Tribunal and
  // Other Legislation Amendment Act 2026, compilation 2026-02-09), cut before
  // the 5th section heading. Every text run is its own <span>; the previous
  // extractor produced zero sections from this shape.
  const html = readFileSync(
    new URL("../fixtures/cth/C2026A00003-document_1.excerpt.html", import.meta.url),
    "utf8"
  );

  it("extracts the sections with their text, not spacer entities", () => {
    const sections = parseActHtml(html);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const s1 = sections.find((s) => s.sectionId === "s 1");
    expect(s1?.title).toBe("Short title");
    expect(s1?.content).toMatch(/^This Act is the Administrative Review Tribunal and Other Legislation Amendment Act 2026\./);
    const s2 = sections.find((s) => s.sectionId === "s 2");
    expect(s2?.title).toBe("Commencement");
    expect(s2?.content).toMatch(/Each provision of this Act specified in column 1/);
    for (const s of sections) {
      expect(s.content).not.toMatch(/&#x|&nbsp;|<span/);
      expect(s.content.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("keeps section order and the in_force status", () => {
    const sections = parseActHtml(html);
    expect(sections.map((s) => s.order)).toEqual(sections.map((_, i) => i));
    expect(new Set(sections.map((s) => s.status))).toEqual(new Set(["in_force"]));
  });
});

describe("parseActHtml on an amending Act that repeats a section (tailor-group#37)", () => {
  // Synthetic excerpt in the same EPUB shape: the schedule amends s 308 of
  // the principal Act five times, so the ActHead5 "308" heading recurs. The
  // real case was cth/act-2026-082, whose repeated ids failed validation and
  // discarded its whole batch.
  const html = readFileSync(
    new URL("../fixtures/cth/amending-act-repeated-s308.excerpt.html", import.meta.url),
    "utf8"
  );

  it("suffixes the later occurrences deterministically and drops nothing", () => {
    const sections = parseActHtml(html);
    expect(sections.map((s) => s.sectionId)).toEqual([
      "s 1", "s 2", "s 3", "s 117C",
      "s 308", "s 308 [2]", "s 308 [3]", "s 308 [4]", "s 308 [5]",
      "s 228AA",
    ]);
    expect(sections.map((s) => s.order)).toEqual(sections.map((_, i) => i));
    expect(sections[4].content).toMatch(/^Subsection 308\(1\) is amended/);
    expect(sections[8].content).toMatch(/^At the end of section 308/);
    expect(sections[8].title).toBe("Amendment 5 of section 308 of the principal Act");
  });

  it("passes normalizeLegislationDocuments as one document", () => {
    const [doc] = normalizeLegislationDocuments([{
      id: "cth/act-2026-082",
      jurisdiction: "CTH",
      type: "act",
      title: "Combatting Illicit Tobacco Act 2026 (Cth)",
      sections: parseActHtml(html),
    }]);
    expect(doc.sections).toHaveLength(10);
  });
});

describe("syncCth isolates ingest failures per document (tailor-group#37)", () => {
  const amendingHtml = readFileSync(
    new URL("../fixtures/cth/amending-act-repeated-s308.excerpt.html", import.meta.url),
    "utf8"
  );
  const titles = [
    { id: "C2026A00082", name: "Combatting Illicit Tobacco Act 2026", year: 2026, number: 82, status: "InForce", seriesType: "Act", makingDate: "2026-09-01T00:00:00" },
    // year 0 fails `documents[0].year` validation, so this one is rejected at ingest.
    { id: "C0000A00005", name: "Broken Metadata Act", year: 0, number: 5, status: "InForce", seriesType: "Act", makingDate: "2026-08-01T00:00:00" },
    { id: "C2026A00003", name: "Administrative Review Tribunal and Other Legislation Amendment Act 2026", year: 2026, number: 3, status: "InForce", seriesType: "Act", makingDate: "2026-02-09T00:00:00" },
  ];

  function fakeFetch(url: string | URL | Request): Promise<Response> {
    const href = String(url);
    if (href.includes("/Titles")) {
      const skip = new URL(href).searchParams.get("$skip");
      return Promise.resolve(Response.json({ value: skip === "0" ? titles : [] }));
    }
    if (href.includes("/Versions")) {
      const titleId = /titleId eq '([^']+)'/.exec(decodeURIComponent(href))?.[1];
      return Promise.resolve(Response.json({
        value: [{ titleId, start: "2026-09-10T00:00:00", registerId: "r", compilationNumber: "0", isLatest: true }],
      }));
    }
    if (href.endsWith("document_1.html")) {
      return Promise.resolve(new Response(amendingHtml, { status: 200 }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("writes the valid documents, counts only them, and records the rejected one as an anomaly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
    vi.useFakeTimers({ toFake: ["setTimeout"] }); // skip the 2 s per-act pause
    const batch = vi.fn<(statements: { sql: string; args: unknown[] }[]) => Promise<void>>(async () => undefined);
    const db = { execute: vi.fn(async () => ({ rows: [] })), batch };

    const pending = syncCth(db as never);
    await vi.runAllTimersAsync();
    const r = await pending;

    expect(r.docsChecked).toBe(3);
    expect(r.docsUpdated).toBe(2);
    expect(r.sectionsTotal).toBe(20);
    expect(r.parserCrashCount).toBe(0);
    expect(r.parserAnomalyCount).toBe(1);
    expect(r.errors).toEqual(["Rejected cth/act-0-005: documents[0].year must be an integer from 1 to 9999, or null"]);

    expect(batch).toHaveBeenCalledTimes(1);
    const upserts = batch.mock.calls[0][0].filter((s) => s.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts.map((s) => s.args[0])).toEqual(["cth/act-2026-003", "cth/act-2026-082"]);
    const sectionIds = batch.mock.calls[0][0]
      .filter((s) => s.sql.includes("INSERT INTO legislation_sections"))
      .map((s) => s.args[0]);
    expect(sectionIds).toContain("cth/act-2026-082/s 308 [5]");
    expect(sectionIds.some((id) => String(id).startsWith("cth/act-0-005/"))).toBe(false);
  });
});

describe("syncCth when the Titles fetch fails", () => {
  it("records a crash, not just an error string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 400 })
    );
    try {
      const r = await syncCth({} as never);
      expect(r.docsChecked).toBe(0);
      expect(r.parserCrashCount).toBe(1);
      expect(r.errors[0]).toMatch(/Titles fetch at skip=0: CTH API 400/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe.skipIf(!process.env.CTH_LIVE)("live api.prod.legislation.gov.au (CTH_LIVE=1)", () => {
  it("returns in-force Acts for the corrected filter", async () => {
    const titles = await fetchInForceActs(0, 5);
    expect(titles.length).toBe(5);
    for (const t of titles) expect(t.status).toBe("InForce");
  }, 30_000);

  it("parses sections out of a current act's EPUB HTML", async () => {
    const [title] = await fetchInForceActs(0, 1);
    const vf = encodeURIComponent(`titleId eq '${title.id}' and isLatest eq true`);
    const v = (await (await fetch(`https://api.prod.legislation.gov.au/v1/Versions?$filter=${vf}&$top=1`)).json()) as {
      value: { start: string }[];
    };
    const start = v.value[0].start.split("T")[0];
    const html = await (await fetch(
      `https://www.legislation.gov.au/${title.id}/${start}/${start}/text/original/epub/OEBPS/document_1/document_1.html`
    )).text();
    const sections = parseActHtml(html);
    expect(sections.length).toBeGreaterThan(0);
    console.log(`[CTH_LIVE] ${title.id} ${title.name}: ${sections.length} sections`);
  }, 60_000);
});
