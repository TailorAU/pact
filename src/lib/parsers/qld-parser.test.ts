/**
 * tailor-group#37 — syncQld pinned through its public entry point, in the
 * same shape as the syncCth isolation test.
 *
 * parseQldHtml is module-private, so the parser is exercised through syncQld
 * with `fetch` spied: authenticate → token, one Documents answer per
 * KEY_ACTS id, one HTML rendition. Two acts are exercised — one whose
 * reprint repeats a section number, one whose metadata fails validation at
 * ingest. The other KEY_ACTS ids answer `repealed: "Y"`, which the sync
 * skips silently (counted in docsChecked, no error, no anomaly), so the
 * error and anomaly assertions see only the rejected document.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../db";

vi.mock("../db", () => ({
  getDb: async () => ({}),
  // A two-method mock has no transaction(): the real helper runs fn on it directly.
  withTransaction: async <T,>(db: DbClient, fn: (tx: DbClient) => Promise<T>) => fn(db),
}));

import { syncQld } from "./qld-parser";

// A reprint in the QLD HTML rendition shape (ActHead5 headings) whose Part 2
// amends s 308 of the principal Act three times, so the "308" heading recurs.
const REPEATING_HTML = `<html><body>
<h2 class="ActHead2">Part 1 — Preliminary</h2>
<h5 class="ActHead5">1 Short title</h5>
<p class="body">This Act may be cited as the Mining Safety Amendment Act 2020.</p>
<h5 class="ActHead5">2 Commencement</h5>
<p class="body">This Act commences on a day to be fixed by proclamation.</p>
<h2 class="ActHead2">Part 2 — Amendment of Coal Mining Safety and Health Act 1999</h2>
<h5 class="ActHead5">308 Amendment of s 308 (Regulation-making power)</h5>
<p class="body">Section 308(1), 'the chief inspector'— omit, insert— 'the regulator'.</p>
<h5 class="ActHead5">308 Amendment of s 308 (Regulation-making power)</h5>
<p class="body">Section 308(2)(a), after 'a coal mine'— insert— 'or a quarry'.</p>
<h5 class="ActHead5">308 Amendment of s 308 (Regulation-making power)</h5>
<p class="body">Section 308— insert— (5) A regulation may prescribe fees for this part.</p>
<h5 class="ActHead5">309 Amendment of s 309 (Transitional regulation-making power)</h5>
<p class="body">Section 309(3), 'expires 1 year'— omit, insert— 'expires 2 years'.</p>
</body></html>`;

type QldDocumentRecord = {
  title: string;
  year: string;
  id: string;
  no: string;
  version_series_id: string;
  print_type: string;
  repealed: string;
  first_valid_date: string;
  end_valid_date: string;
  _links: Record<string, never>;
};

const EXERCISED: Record<string, Pick<QldDocumentRecord, "title" | "year" | "no" | "repealed" | "first_valid_date">> = {
  "Act-1999-039": { title: "Coal Mining Safety and Health Act 1999", year: "1999", no: "39", repealed: "N", first_valid_date: "2026-09-01" },
  // parseInt("0") fails `documents[0].year` validation (1–9999), so this one is rejected at ingest.
  "Act-1999-040": { title: "Broken Metadata Act", year: "0", no: "5", repealed: "N", first_valid_date: "2026-08-01" },
};

function versionOf(actId: string): QldDocumentRecord {
  const exercised = EXERCISED[actId] ?? {
    title: `Repealed ${actId}`, year: "1964", no: "47", repealed: "Y", first_valid_date: "2020-01-01",
  };
  return { ...exercised, id: actId, version_series_id: "v1", print_type: "act-reprint", end_valid_date: "", _links: {} };
}

function fakeFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const href = String(url);
  if (href.endsWith("/v1/auth/token") && init?.method === "POST") {
    return Promise.resolve(Response.json({
      auth_type: "Bearer", access_token: "tok", access_token_exp_at: 0, refresh_token: "r",
    }));
  }
  if (href.includes("/v1/documents?")) {
    const actId = new URL(href).searchParams.get("id") ?? "";
    return Promise.resolve(Response.json({
      documents: [versionOf(actId)],
      _meta: { total_records: 1, total_pages: 1, page: 1, limit: 50, count: 1 },
    }));
  }
  if (href.includes("/v1/renditions/html/")) {
    return Promise.resolve(new Response(REPEATING_HTML, { status: 200 }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

describe("syncQld isolates ingest failures per document (tailor-group#37)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("suffixes the repeated section ids, counts only written documents, and records the rejected one as an anomaly", async () => {
    vi.stubEnv("QLD_LEGISLATION_USERNAME", "svc");
    vi.stubEnv("QLD_LEGISLATION_PASSWORD", "secret");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
    vi.useFakeTimers({ toFake: ["setTimeout"] }); // skip the 2 s per-act pause
    const batch = vi.fn<(statements: { sql: string; args: unknown[] }[]) => Promise<void>>(async () => undefined);
    const db = { execute: vi.fn(async () => ({ rows: [] })), batch };

    const pending = syncQld(db as never);
    await vi.runAllTimersAsync();
    const r = await pending;

    expect(r.jurisdiction).toBe("QLD");
    expect(r.parserVersion).toBe("qld-parser@1.6.1");
    expect(r.docsChecked).toBe(9); // every KEY_ACTS id, repealed ones included
    expect(r.docsUpdated).toBe(1); // the rejected document is not counted
    expect(r.sectionsTotal).toBe(6);
    expect(r.parserCrashCount).toBe(0);
    expect(r.parserAnomalyCount).toBe(1);
    expect(r.errors).toEqual(["Rejected qld/act-0-005: documents[0].year must be an integer from 1 to 9999, or null"]);

    // Only the two non-repealed acts were fetched as HTML.
    const renditions = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/v1/renditions/html/"));
    expect(renditions).toHaveLength(2);

    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0][0];
    const upserts = statements.filter((s) => s.sql.includes("INSERT INTO legislation_docs"));
    expect(upserts.map((s) => s.args[0])).toEqual(["qld/act-1999-039"]);
    const sectionIds = statements
      .filter((s) => s.sql.includes("INSERT INTO legislation_sections"))
      .map((s) => s.args[0]);
    expect(sectionIds).toEqual([
      "qld/act-1999-039/s 1",
      "qld/act-1999-039/s 2",
      "qld/act-1999-039/s 308",
      "qld/act-1999-039/s 308 [2]",
      "qld/act-1999-039/s 308 [3]",
      "qld/act-1999-039/s 309",
    ]);
    expect(sectionIds.some((id) => String(id).startsWith("qld/act-0-005/"))).toBe(false);
  });
});

describe("syncQld strips script/style robustly and decodes entities once (tailor-group#7)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // `</script >` (space before ">") escaped the old `<\/script>` filter
  // (js/bad-tag-filter), and the chained decoder turned `&amp;lt;` into "<"
  // (js/double-escaping).
  const HOSTILE_HTML = `<html><head><style type="text/css">p { color: STYLE_BODY_MARKER; }</STYLE></head><body>
<h5 class="ActHead5">1 Definitions</h5>
<script type="text/javascript">var leaked = "SCRIPT_BODY_MARKER";</script >
<p class="body">In this Act, write &amp;lt;tag&amp;gt; for a tag, and &lt;b&gt; means b.</p>
<h5 class="ActHead5">2 Commencement</h5>
<p class="body">This Act commences on the date of assent.</p>
</body></html>`;

  it("drops the script and style bodies and keeps escaped entities literal", async () => {
    vi.stubEnv("QLD_LEGISLATION_USERNAME", "svc");
    vi.stubEnv("QLD_LEGISLATION_PASSWORD", "secret");
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) =>
      String(url).includes("/v1/renditions/html/")
        ? Promise.resolve(new Response(HOSTILE_HTML, { status: 200 }))
        : fakeFetch(url, init)
    );
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const batch = vi.fn<(statements: { sql: string; args: unknown[] }[]) => Promise<void>>(async () => undefined);
    const db = { execute: vi.fn(async () => ({ rows: [] })), batch };

    const pending = syncQld(db as never);
    await vi.runAllTimersAsync();
    await pending;

    const sections = batch.mock.calls[0][0].filter((st) => st.sql.includes("INSERT INTO legislation_sections"));
    // args: id, doc_id, section_id, title, content, …
    const contentOf = (id: string) => sections.find((st) => st.args[0] === id)?.args[4];
    expect(contentOf("qld/act-1999-039/s 1")).toBe(
      "In this Act, write &lt;tag&gt; for a tag, and <b> means b."
    );
    expect(contentOf("qld/act-1999-039/s 2")).toBe("This Act commences on the date of assent.");
    for (const st of sections) {
      expect(String(st.args[4])).not.toMatch(/SCRIPT_BODY_MARKER|STYLE_BODY_MARKER/);
    }
  });
});

describe("syncQld without credentials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("records the configuration miss and never reaches the network", async () => {
    vi.stubEnv("QLD_LEGISLATION_USERNAME", "");
    vi.stubEnv("QLD_LEGISLATION_PASSWORD", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await syncQld({} as never);

    expect(r.errors).toEqual(["QLD_LEGISLATION_USERNAME and QLD_LEGISLATION_PASSWORD not configured"]);
    expect(r.docsChecked).toBe(0);
    expect(r.docsUpdated).toBe(0);
    expect(r.parserAnomalyCount).toBe(0);
    expect(r.parserCrashCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
