/**
 * #5425 — Source-level invariant: the consensus engine runs ONLY from the
 * cron surface.
 *
 * `autoMergeExpired` (the engine) and `runConsensusSweep` (its
 * advisory-locked entry point) must never be imported or invoked from any
 * API route outside `src/app/api/cron/**`, nor from the server-component
 * read path (`src/lib/queries.ts`). Before #5425 the engine ran on GET
 * requests from five read paths, racing promotions between concurrent
 * readers.
 *
 * This scan covers every `.ts` file under src/app/api — test files
 * included — so a future test cannot quietly re-mock the engine into a
 * read path either.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");
const API_ROOT = path.join(SRC_ROOT, "app", "api");
const CRON_DIR = path.join(API_ROOT, "cron") + path.sep;

// Matches the identifiers as words — an import, a call, or a mock alike.
const ENGINE_IDENTIFIERS = /\b(autoMergeExpired|runConsensusSweep)\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

describe("#5425 — consensus engine is cron-only", () => {
  it("no file under src/app/api outside /api/cron references the engine entry points", () => {
    const files = walk(API_ROOT).filter((f) => !f.startsWith(CRON_DIR));
    expect(files.length).toBeGreaterThan(0); // the scan itself must be live
    const offenders = files
      .filter((f) => ENGINE_IDENTIFIERS.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the cron routes DO invoke the engine (the invariant has teeth)", () => {
    const cronFiles = walk(path.join(API_ROOT, "cron"));
    const invokers = cronFiles.filter((f) =>
      ENGINE_IDENTIFIERS.test(fs.readFileSync(f, "utf8"))
    );
    expect(invokers.length).toBeGreaterThan(0);
  });

  it("src/lib/queries.ts (the server-component read path) does not invoke the engine", () => {
    const src = fs.readFileSync(path.join(SRC_ROOT, "lib", "queries.ts"), "utf8");
    expect(ENGINE_IDENTIFIERS.test(src)).toBe(false);
  });
});
