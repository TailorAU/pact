/**
 * WS9 — Regression tests for the silent-zero alarm in runLegislationSync.
 *
 * The audit (#1401 origin) found CTH last_amended_date stuck at 2024-12-01 and
 * QLD at 2024-10-01 with `legislation_sync_log.docs_updated = 0` and no errors
 * raised. Silent parser drops were indistinguishable from "ran cleanly, no new
 * amendments upstream". This suite locks in three behaviours:
 *
 *   1. Anomalies + zero updates → `silent_zero_flag = true` written to the log
 *      AND a structured `legislation.sync.silent_zero` warn emitted to stderr.
 *   2. Zero anomalies + zero updates → `silent_zero_flag = false`, no warn.
 *      (Legitimate "nothing new upstream" — the freshness probe handles this
 *      case, not the silent-zero flag.)
 *   3. parser_version, parser_crash_count, parser_anomaly_count are stamped
 *      onto every row regardless of silent-zero outcome.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "./db";
import type { SyncResult } from "./legislation-sync";

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

vi.mock("./db", () => ({
  getDb: async () => mockDb as unknown as DbClient,
}));

const cthSpy = vi.fn<() => Promise<SyncResult>>();
const qldSpy = vi.fn<() => Promise<SyncResult>>();

vi.mock("./parsers/cth-parser", () => ({
  syncCth: () => cthSpy(),
}));
vi.mock("./parsers/qld-parser", () => ({
  syncQld: () => qldSpy(),
}));

// Snapshot stderr writes from the structured logger. We don't care about the
// info-level INSERT/UPDATE log lines, just the warn-level silent-zero one.
let stderrWrites: string[];
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockDb.execute.mockReset();
  mockDb.execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
  cthSpy.mockReset();
  qldSpy.mockReset();
  stderrWrites = [];
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrWrites.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
});

function findUpdateLogCall(): { sql: string; args: unknown[] } | undefined {
  const updateCall = mockDb.execute.mock.calls.find((call) => {
    const arg = call[0];
    return (
      typeof arg === "object" &&
      arg !== null &&
      "sql" in arg &&
      typeof arg.sql === "string" &&
      arg.sql.includes("UPDATE legislation_sync_log")
    );
  });
  return updateCall?.[0] as { sql: string; args: unknown[] } | undefined;
}

function findSilentZeroLog(): Record<string, unknown> | undefined {
  for (const line of stderrWrites) {
    for (const json of line.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(json);
        if (parsed.op === "legislation.sync.silent_zero") {
          return parsed;
        }
      } catch {
        // not JSON — skip
      }
    }
  }
  return undefined;
}

describe("runLegislationSync — silent-zero alarm", () => {
  it("flags silent-zero when the parser reported anomalies but updated nothing", async () => {
    cthSpy.mockResolvedValue({
      jurisdiction: "CTH",
      docsChecked: 50,
      docsUpdated: 0,
      sectionsTotal: 0,
      errors: ["No sections parsed for Foo Act 2020 (html 12345 chars)"],
      parserVersion: "cth-parser@2.0.0",
      parserAnomalyCount: 50,
      parserCrashCount: 0,
    });

    const { runLegislationSync } = await import("./legislation-sync");
    const results = await runLegislationSync(["CTH"]);

    expect(results).toHaveLength(1);
    expect(results[0].docsUpdated).toBe(0);

    const update = findUpdateLogCall();
    expect(update).toBeDefined();
    // args order: docsChecked, docsUpdated, sectionsTotal, errorsJson,
    //             silentZero, parserVersion, parserCrashCount,
    //             parserAnomalyCount, runId
    expect(update!.args[4]).toBe(true);
    expect(update!.args[5]).toBe("cth-parser@2.0.0");
    expect(update!.args[6]).toBe(0);
    expect(update!.args[7]).toBe(50);

    const warnEntry = findSilentZeroLog();
    expect(warnEntry).toBeDefined();
    expect(warnEntry!.jurisdiction).toBe("CTH");
    expect(warnEntry!.parserAnomalyCount).toBe(50);
    expect(warnEntry!.parserVersion).toBe("cth-parser@2.0.0");
    expect(warnEntry!.runId).toEqual(expect.any(String));
  });

  it("does NOT flag silent-zero when zero updates is the legitimate case (no anomalies)", async () => {
    cthSpy.mockResolvedValue({
      jurisdiction: "CTH",
      docsChecked: 50,
      docsUpdated: 0,
      sectionsTotal: 0,
      errors: [],
      parserVersion: "cth-parser@2.0.0",
      parserAnomalyCount: 0,
      parserCrashCount: 0,
    });

    const { runLegislationSync } = await import("./legislation-sync");
    await runLegislationSync(["CTH"]);

    const update = findUpdateLogCall();
    expect(update).toBeDefined();
    expect(update!.args[4]).toBe(false);

    expect(findSilentZeroLog()).toBeUndefined();
  });

  it("does NOT flag silent-zero when work was done (docs updated)", async () => {
    cthSpy.mockResolvedValue({
      jurisdiction: "CTH",
      docsChecked: 50,
      docsUpdated: 12,
      sectionsTotal: 240,
      errors: ["transient anomaly on one act"],
      parserVersion: "cth-parser@2.0.0",
      parserAnomalyCount: 1,
      parserCrashCount: 0,
    });

    const { runLegislationSync } = await import("./legislation-sync");
    await runLegislationSync(["CTH"]);

    const update = findUpdateLogCall();
    expect(update!.args[4]).toBe(false);
    expect(findSilentZeroLog()).toBeUndefined();
  });

  it("stamps parser_version, parser_crash_count, parser_anomaly_count on every row", async () => {
    qldSpy.mockResolvedValue({
      jurisdiction: "QLD",
      docsChecked: 9,
      docsUpdated: 7,
      sectionsTotal: 410,
      errors: ["one act crashed mid-fetch"],
      parserVersion: "qld-parser@1.5.0",
      parserAnomalyCount: 1,
      parserCrashCount: 1,
    });

    const { runLegislationSync } = await import("./legislation-sync");
    await runLegislationSync(["QLD"]);

    const update = findUpdateLogCall();
    expect(update).toBeDefined();
    expect(update!.args[5]).toBe("qld-parser@1.5.0");
    expect(update!.args[6]).toBe(1); // parser_crash_count
    expect(update!.args[7]).toBe(1); // parser_anomaly_count
  });

  it("treats whole-jurisdiction throws as crashes, not silent-zero", async () => {
    cthSpy.mockRejectedValue(new Error("CTH API down"));

    const { runLegislationSync } = await import("./legislation-sync");
    const results = await runLegislationSync(["CTH"]);

    expect(results[0].errors).toContain("CTH API down");
    expect(results[0].parserCrashCount).toBe(1);

    const update = findUpdateLogCall();
    // docs_checked = 0 → cannot be silent-zero; the freshness probe surfaces
    // this case via "no completed sync recently" instead.
    expect(update!.args[4]).toBe(false);
    expect(findSilentZeroLog()).toBeUndefined();
  });
});
