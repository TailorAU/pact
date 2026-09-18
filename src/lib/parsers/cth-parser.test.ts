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
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: async () => ({}) }));

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
