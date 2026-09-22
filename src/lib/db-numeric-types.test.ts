/**
 * #5525 — pin the numeric types node-postgres hands back from a REAL
 * Postgres wire response.
 *
 * The #5424/#5427 sweep harness mocks the SQL surface with JS numbers, so
 * it can never catch the class of defect this file pins: real Postgres
 * sends int8 (COUNT(*), SUM(<int>), bigint) as TEXT, and pg ships NO
 * default int8 parser — every such value surfaces as a string unless
 * db.ts registers one. Strict sweep checks (`pending === 0`,
 * dependencyGateOk's `unmetDeps === 0`, `support === 0`) are then false
 * for "0", and ratio arithmetic concatenates ("3" + "1" === "31").
 *
 * These tests are integration-shaped at the exact seam pg uses when
 * decoding a wire row: pg's result reader looks up
 * `pg.types.getTypeParser(<column OID>, "text")` and feeds it the raw
 * text Postgres sent. Asserting through getTypeParser therefore exercises
 * precisely what a real query result goes through — no numeric mock in
 * the path. Importing "@/lib/db" (module init) is what registers the
 * parsers under test.
 */
import { describe, it, expect } from "vitest";
import pg from "pg";
import { dependencyGateOk } from "@/lib/consensus-gate";
import { meetsStanding, INDEPENDENCE_CONFIG } from "@/lib/independence";
import "@/lib/db"; // module init registers the type parsers

const parse = (oid: number, wireText: string): unknown =>
  pg.types.getTypeParser(oid, "text")(wireText);

// PostgreSQL type OIDs as they arrive in RowDescription for these types.
const INT8 = 20; // bigint — COUNT(*), SUM(integer)
const INT4 = 23; // integer
const FLOAT8 = 701; // double precision — consensus_ratio, credence, amounts
const NUMERIC = 1700; // numeric — fiscal dollar columns, EXTRACT(...)/86400.0
const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;

describe("#5525 — int8 (COUNT(*)/SUM) comes back as a JS number", () => {
  it("parses int8 wire text to a number", () => {
    expect(parse(INT8, "0")).toBe(0);
    expect(parse(INT8, "42")).toBe(42);
    expect(parse(INT8, "-7")).toBe(-7);
    expect(typeof parse(INT8, "123456789")).toBe("number");
  });

  it("COUNT(*) = 0 passes the sweep's strict checks", () => {
    const pending = parse(INT8, "0");
    // The Phase-1 promotion gate and the vexatious-challenge gate are
    // strict equalities; "0" === 0 is false, which is the defect class.
    expect(pending === 0).toBe(true);
    // dependencyGateOk is `unmetDeps === 0` — must hold for a wire zero.
    expect(dependencyGateOk("practice", parse(INT8, "0") as number)).toBe(true);
    expect(dependencyGateOk("practice", parse(INT8, "1") as number)).toBe(false);
  });

  it("ratio arithmetic over wire counts is numeric, not concatenation", () => {
    const aligned = parse(INT8, "3") as number;
    const dissenting = parse(INT8, "1") as number;
    const totalVoters = aligned + dissenting;
    expect(totalVoters).toBe(4); // strings would give "31"
    expect(aligned / totalVoters).toBe(0.75);
  });

  it("is exact through Number.MAX_SAFE_INTEGER (documented bound)", () => {
    expect(parse(INT8, "9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    // Beyond 2^53 − 1 precision loss is accepted (see the db.ts bounds
    // note) — the value is still a number, never a string.
    expect(typeof parse(INT8, "9007199254740993")).toBe("number");
  });
});

describe("#5525 — surrounding numeric types are pinned, not drifted", () => {
  it("int4 and float8 stay numbers (pg defaults)", () => {
    expect(parse(INT4, "5")).toBe(5);
    expect(parse(FLOAT8, "0.9")).toBe(0.9);
  });

  it("NUMERIC deliberately stays text (fiscal NUMERIC-never-float)", () => {
    // sql/fiscal-reconstruction-schema.sql stores dollar figures as
    // NUMERIC; db.ts deliberately does not register a lossy Number parser
    // for OID 1700.
    expect(parse(NUMERIC, "12.50")).toBe("12.50");
    // The one numeric read on the sweep path (agent_age_days) is coerced
    // downstream by meetsStanding, which Number()-wraps its inputs.
    expect(
      meetsStanding(
        String(INDEPENDENCE_CONFIG.minAccountAgeDays),
        String(INDEPENDENCE_CONFIG.minAcceptedContributions)
      )
    ).toBe(true);
  });

  it("timestamps stay ISO-ish strings (pre-existing parsers)", () => {
    expect(parse(TIMESTAMP, "2026-08-28 01:00:00")).toBe("2026-08-28 01:00:00");
    expect(parse(TIMESTAMPTZ, "2026-08-28 01:00:00+00")).toBe("2026-08-28 01:00:00+00");
  });
});
