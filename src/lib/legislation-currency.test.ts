/**
 * pact#28 ask-6 (#4462) — unit tests for the citation currency stamp and
 * the cheap since-probe behind GET /api/axiom/resolve and
 * GET /api/axiom/legislation/{id}.
 */
import { describe, it, expect } from "vitest";
import {
  buildCitationCurrency,
  evaluateSince,
  sectionFingerprint,
  stableDigest,
  toIsoDate,
} from "./legislation-currency";

const REG = {
  id: "qld/reg-2017-165",
  title: "Coal Mining Safety and Health Regulation 2017 (Qld)",
  in_force_date: "2017-09-01",
  last_amended_date: "2024-07-01",
  repealed_date: null,
  created_at: "2025-01-01T00:00:00Z",
};

describe("toIsoDate", () => {
  it("passes through ISO dates and truncates timestamps", () => {
    expect(toIsoDate("2024-07-01")).toBe("2024-07-01");
    expect(toIsoDate("2024-07-01T12:34:56Z")).toBe("2024-07-01");
  });
  it("handles Date objects", () => {
    expect(toIsoDate(new Date("2024-07-01T00:00:00Z"))).toBe("2024-07-01");
  });
  it("returns null for empty / invalid / nullish input", () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("   ")).toBeNull();
    expect(toIsoDate("not-a-date")).toBeNull();
  });
});

describe("stableDigest", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(stableDigest("abc")).toBe(stableDigest("abc"));
    expect(stableDigest("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("differs for different input", () => {
    expect(stableDigest("abc")).not.toBe(stableDigest("abd"));
  });
  it("handles empty input", () => {
    expect(stableDigest("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("buildCitationCurrency", () => {
  it("uses the last amendment as asAt for an in-force instrument", () => {
    const c = buildCitationCurrency(REG);
    expect(c.asAt).toBe("2024-07-01");
    expect(c.lastAmendedDate).toBe("2024-07-01");
    expect(c.inForceDate).toBe("2017-09-01");
    expect(c.repealedDate).toBeNull();
    expect(c.contentVersion).toMatch(/^[0-9a-f]{8}$/);
  });

  it("prefers the repeal date once repealed", () => {
    const c = buildCitationCurrency({ ...REG, repealed_date: "2025-06-30" });
    expect(c.asAt).toBe("2025-06-30");
    expect(c.repealedDate).toBe("2025-06-30");
  });

  it("falls back commencement → created_at when no amendment is recorded", () => {
    expect(buildCitationCurrency({ ...REG, last_amended_date: null }).asAt).toBe("2017-09-01");
    expect(
      buildCitationCurrency({ ...REG, last_amended_date: null, in_force_date: null }).asAt
    ).toBe("2025-01-01");
  });

  it("asAt is null when the row carries no dates at all", () => {
    expect(
      buildCitationCurrency({ id: "x", title: "X", in_force_date: null, last_amended_date: null, repealed_date: null, created_at: null }).asAt
    ).toBeNull();
  });

  it("never claims point-in-time support (only current consolidations are stored)", () => {
    expect(buildCitationCurrency(REG).pointInTimeSupported).toBe(false);
  });

  it("labels the digest scope so callers never compare incomparable stamps", () => {
    expect(buildCitationCurrency(REG).versionScope).toBe("metadata");
    expect(buildCitationCurrency(REG, sectionFingerprint([{ section_id: "r 3", content: "a" }])).versionScope).toBe(
      "metadata+sections"
    );
    // The two scopes are genuinely different digests — hence the label.
    expect(buildCitationCurrency(REG).contentVersion).not.toBe(
      buildCitationCurrency(REG, sectionFingerprint([{ section_id: "r 3", content: "a" }])).contentVersion
    );
  });

  it("contentVersion is stable for an unchanged row", () => {
    expect(buildCitationCurrency(REG).contentVersion).toBe(buildCitationCurrency({ ...REG }).contentVersion);
  });

  it("contentVersion moves when any currency-bearing field moves", () => {
    const base = buildCitationCurrency(REG).contentVersion;
    expect(buildCitationCurrency({ ...REG, last_amended_date: "2025-02-02" }).contentVersion).not.toBe(base);
    expect(buildCitationCurrency({ ...REG, repealed_date: "2025-02-02" }).contentVersion).not.toBe(base);
    expect(buildCitationCurrency({ ...REG, title: "Renamed" }).contentVersion).not.toBe(base);
  });

  // The #1401 failure mode: section text is rewritten but last_amended_date
  // is stuck. The section fingerprint must still move the version.
  it("contentVersion moves when section content changes even if the dates are stuck", () => {
    const a = buildCitationCurrency(REG, sectionFingerprint([{ section_id: "r 89", content: "old" }]));
    const b = buildCitationCurrency(REG, sectionFingerprint([{ section_id: "r 89", content: "new" }]));
    expect(a.contentVersion).not.toBe(b.contentVersion);
  });
});

describe("sectionFingerprint", () => {
  it("is stable for the same sections and independent of row order", () => {
    const a = [{ section_id: "r 3", content: "aaa" }, { section_id: "r 89", content: "bbb" }];
    const b = [{ section_id: "r 89", content: "bbb" }, { section_id: "r 3", content: "aaa" }];
    expect(sectionFingerprint(a)).toBe(sectionFingerprint(b));
  });
  it("moves when a section is added, removed, or edited", () => {
    const base = sectionFingerprint([{ section_id: "r 3", content: "aaa" }]);
    expect(sectionFingerprint([{ section_id: "r 3", content: "aaa" }, { section_id: "r 4", content: "b" }])).not.toBe(base);
    expect(sectionFingerprint([])).not.toBe(base);
    expect(sectionFingerprint([{ section_id: "r 3", content: "aab" }])).not.toBe(base);
  });
  it("accepts the camelCase shape the formatted API layer uses", () => {
    expect(sectionFingerprint([{ sectionId: "r 3", content: "aaa" }])).toBe(
      sectionFingerprint([{ section_id: "r 3", content: "aaa" }])
    );
  });
});

describe("evaluateSince", () => {
  const currency = buildCitationCurrency(REG);

  it("reports unchanged for a matching contentVersion", () => {
    const p = evaluateSince(currency.contentVersion, currency);
    expect(p.changed).toBe(false);
    expect(p.basis).toBe("contentVersion");
  });

  it("reports changed for a stale contentVersion", () => {
    const p = evaluateSince("deadbeef", currency);
    expect(p.changed).toBe(true);
    expect(p.basis).toBe("contentVersion");
  });

  it("is case-insensitive on the version stamp", () => {
    expect(evaluateSince(currency.contentVersion.toUpperCase(), currency).changed).toBe(false);
  });

  it("compares dates when given an ISO date", () => {
    // Stored consolidation (2024-07-01) is newer than what the caller saw.
    expect(evaluateSince("2020-01-01", currency)).toEqual({
      since: "2020-01-01",
      changed: true,
      basis: "asAt",
    });
    // Caller is already current / ahead.
    expect(evaluateSince("2024-07-01", currency).changed).toBe(false);
    expect(evaluateSince("2030-01-01", currency).changed).toBe(false);
  });

  // Fail-open: a freshness probe must never answer a confident "unchanged"
  // it cannot justify — that would let a Living Document keep citing
  // superseded law.
  it("fails OPEN (changed: true) on an unparseable stamp", () => {
    expect(evaluateSince("garbage", currency)).toEqual({
      since: "garbage",
      changed: true,
      basis: "unparseable",
    });
    expect(evaluateSince("", currency).changed).toBe(true);
    expect(evaluateSince("   ", currency).changed).toBe(true);
  });

  it("fails OPEN when a date was given but the doc has no asAt", () => {
    const noDates = buildCitationCurrency({
      id: "x", title: "X", in_force_date: null, last_amended_date: null, repealed_date: null, created_at: null,
    });
    expect(evaluateSince("2020-01-01", noDates).changed).toBe(true);
    expect(evaluateSince("2020-01-01", noDates).basis).toBe("unparseable");
  });
});
