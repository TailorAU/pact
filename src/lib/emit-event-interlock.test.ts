/**
 * #5599 PR-C — G7: the static source walker for emitEvent transaction
 * discipline, plus the mock-suite unit pins on the chain-append interlock.
 *
 * WHAT THE WALKER IS, AND IS NOT
 * ------------------------------
 * The walker below is FILE-LEVEL STATIC ANALYSIS — deliberately. It does not
 * build an AST or a call graph; it classifies every production `emitEvent`
 * call site by its first argument and by file-scoped conventions this
 * codebase actually holds (verified here, not assumed). That means it is the
 * PRE-MERGE NET, not the closure: the runtime interlock in `emitEvent`
 * itself (db.ts — a pooled client with `transaction` support that is NOT
 * inside a transaction gets `ChainAppendError`, never a second transaction)
 * is what actually closes the §6.4 completeness hole. The walker exists so a
 * violating call site fails `npm test` at PR time instead of throwing in
 * production.
 *
 * CLASSIFICATION RULES (a site must satisfy exactly one):
 *  (a) First argument is `tx` — the repo-wide name for the client handed to a
 *      `withTransaction(db, (tx) => …)` / `scoped.transaction((tx) => …)`
 *      callback. File-level backing for the convention, asserted below:
 *        - the file must actually contain a transaction wrapper call, and
 *        - NO production file may bind `tx` via const/let/var (except the
 *          one known binding: `createTransactionScopedClient`'s own `const
 *          tx: DbClient` in lib/db.ts, which IS the in-transaction client),
 *      so `tx` cannot name anything except an in-transaction client.
 *  (b) First argument is `db` — a caller-threaded helper parameter. Allowed
 *      ONLY at the sites pinned in THREADED_HELPER_EMIT_CENSUS, and only
 *      while every production caller of that helper passes `tx` as ITS first
 *      argument (checked below). A new `db`-first-arg emit site anywhere
 *      fails the census until it is classified here — the #5599 series was
 *      undercounted twice; the census is the discipline that stops a third.
 *  (c) The call line carries the literal marker `#5599 mock-only` — an
 *      explicit annotation that the site can only ever receive a two-method
 *      test mock (no `transaction` support). No production site currently
 *      needs it; it exists so a future legitimate case is an annotated
 *      decision, not a silent hole.
 *
 * Anything else — any other identifier, any expression — is a violation.
 * Fail-closed: the walker names the file, line and argument so the fix is
 * mechanical (wrap the mutating region in `withTransaction` and pass the
 * callback's `tx`).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { emitEvent, ChainAppendError, type DbClient } from "@/lib/db";

const SRC_DIR = path.resolve(__dirname, "..");

// ─── Source enumeration ──────────────────────────────────────────────────────

/** Every production .ts/.tsx under src/ — tests (.test.ts) and real-Postgres
 *  integration suites (.itest.ts) excluded. NOTE: `.itest.ts` does NOT end
 *  with `.test.ts` (the dot is load-bearing), so both suffixes are named. */
function productionSourceFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionSourceFiles(full));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".itest.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Path relative to src/, forward slashes, for stable census keys. */
function rel(file: string): string {
  return path.relative(SRC_DIR, file).replace(/\\/g, "/");
}

// ─── Comment-blanking scanner ────────────────────────────────────────────────

/**
 * Replace every `//…` and `/* … *​/` comment with SPACES (newlines kept), and
 * copy string/template literals VERBATIM. Same state-machine discipline as
 * provenance-chain.test.ts's scanner (a naive regex pair treats the `/*` in a
 * line comment like `// the /api/fiscal/* routes` as a block opener and blinds
 * itself to most of the file), with one difference on purpose: comments become
 * equal-length whitespace instead of being dropped, so every offset in the
 * blanked code equals its offset in the raw source — which is what lets the
 * mock-only annotation check read the RAW line for a match found in the
 * blanked code.
 *
 * Strings kept verbatim means a literal like "call emitEvent outside any
 * transaction" (pact-profile.ts) survives — safe, because the walker matches
 * the CALL shape `emitEvent(`, which prose does not contain. A string that
 * ever did contain the call shape would be a loud false positive, never a
 * silent miss.
 */
function blankComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        const closed = source[i] === c;
        i++;
        if (closed) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ─── Call-site extraction ────────────────────────────────────────────────────

interface EmitCallSite {
  readonly file: string;
  readonly line: number;
  readonly firstArg: string;
  readonly mockOnly: boolean;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === "\n") line++;
  return line;
}

/** First argument of the call starting right after `emitEvent(`: everything
 *  up to the first comma at paren/bracket depth 0, whitespace collapsed. */
function firstArgumentAt(code: string, openParen: number): string {
  let depth = 0;
  let arg = "";
  for (let i = openParen + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) break;
    arg += c;
  }
  return arg.replace(/\s+/g, " ").trim();
}

/** All `emitEvent(` / `<helper>(` CALL sites in comment-blanked code. The
 *  declaration itself (`function emitEvent(`) is not a call and is skipped. */
function findCallSites(rawSource: string, file: string, callee: string): EmitCallSite[] {
  const code = blankComments(rawSource);
  const sites: EmitCallSite[] = [];
  const pattern = new RegExp(String.raw`\b${callee}\s*\(`, "g");
  for (const match of code.matchAll(pattern)) {
    const offset = match.index;
    const before = code.slice(Math.max(0, offset - 40), offset);
    if (/\bfunction\s+$/.test(before)) continue; // the declaration, not a call
    if (/[.\w$]$/.test(before)) continue; // property access / longer identifier
    const openParen = offset + match[0].length - 1;
    const line = lineAt(code, offset);
    const rawLine = rawSource.split("\n")[line - 1] ?? "";
    sites.push({
      file,
      line,
      firstArg: firstArgumentAt(code, openParen),
      mockOnly: rawLine.includes("#5599 mock-only"),
    });
  }
  return sites;
}

// ─── The census of caller-threaded `db` emit sites ───────────────────────────

/**
 * Every production helper that emits on a caller-supplied `db` parameter.
 * `emitDbSites` pins HOW MANY `db`-first-arg emit sites its defining file
 * carries — a new one anywhere fails the census below until classified.
 * For each helper, every production CALL site must pass `tx` as the first
 * argument (asserted below), which is what discharges the sites here.
 */
const THREADED_HELPER_EMIT_CENSUS: readonly {
  readonly definedIn: string;
  readonly emitDbSites: number;
  readonly helpers: readonly string[];
  readonly why: string;
}[] = [
  {
    definedIn: "lib/db.ts",
    emitDbSites: 4,
    helpers: ["finalizeApprovedTopic", "finalizeRejectedTopic"],
    why:
      "quorum finalizers (legislation.ingested / apply-blocked / topic.approved / topic.rejected) — " +
      "called by evaluateTopicProposals' per-decision transactions and by the vote route's " +
      "threshold branch, both passing the withTransaction callback's tx",
  },
  {
    definedIn: "lib/economy.ts",
    emitDbSites: 2,
    helpers: ["distributeBounty", "ensureLegacySplitBounty"],
    why:
      "bounty.distributed rides the sweep's phase-1 decision transaction (under withSavepoint); " +
      "bounty.legacy-split-seeded rides cron/cleanup's per-topic transaction (#5599 PR-C)",
  },
  {
    definedIn: "lib/assumptions.ts",
    emitDbSites: 1,
    helpers: ["processAssumptions"],
    why: "topic.proposed for assumption-gate topics — called only from the done route's request transaction",
  },
];

/** Textual evidence a file wraps mutating regions in a transaction. */
const TX_WRAPPER_MARKERS = ["withTransaction(", ".transaction("] as const;

function classifyViolations(
  sites: EmitCallSite[],
  fileSource: Map<string, string>,
  opts: { fullCensus: boolean }
): string[] {
  const violations: string[] = [];
  const dbSiteCountByFile = new Map<string, number>();

  for (const site of sites) {
    if (site.mockOnly) continue; // rule (c) — explicit annotation
    if (site.firstArg === "tx") {
      // rule (a) — but only meaningful in a file that actually opens one.
      const source = fileSource.get(site.file) ?? "";
      if (!TX_WRAPPER_MARKERS.some((m) => source.includes(m))) {
        violations.push(
          `${site.file}:${site.line} emits on \`tx\` but the file never opens a transaction ` +
            `(no ${TX_WRAPPER_MARKERS.join(" / ")}) — nothing in scope can have bound tx to an in-transaction client`
        );
      }
      continue;
    }
    if (site.firstArg === "db") {
      dbSiteCountByFile.set(site.file, (dbSiteCountByFile.get(site.file) ?? 0) + 1);
      continue; // counted against the census below
    }
    violations.push(
      `${site.file}:${site.line} calls emitEvent(${site.firstArg}, …) — not the withTransaction/` +
        `scoped.transaction callback's \`tx\`, not an inventoried caller-threaded \`db\`, ` +
        `and not annotated \`#5599 mock-only\``
    );
  }

  // The census: db-first-arg sites exist ONLY in the inventoried files, in
  // EXACTLY the pinned quantity.
  const expected = new Map(THREADED_HELPER_EMIT_CENSUS.map((e) => [e.definedIn, e.emitDbSites]));
  for (const [file, count] of dbSiteCountByFile) {
    const want = expected.get(file);
    if (want === undefined) {
      violations.push(
        `${file} has ${count} emitEvent(db, …) site(s) but is not in THREADED_HELPER_EMIT_CENSUS — ` +
          `classify it (and verify every caller threads tx) before merging`
      );
    } else if (count !== want) {
      violations.push(
        `${file} has ${count} emitEvent(db, …) site(s); the census pins ${want} — ` +
          `a site was added or removed without updating THREADED_HELPER_EMIT_CENSUS`
      );
    }
  }
  // Census completeness runs only over a full-repo scan — a self-test's
  // synthetic site list legitimately lacks the inventoried files.
  if (opts.fullCensus) {
    for (const [file, want] of expected) {
      if (!dbSiteCountByFile.has(file) && want > 0) {
        violations.push(
          `${file} is in THREADED_HELPER_EMIT_CENSUS (${want} site(s)) but has none — stale census entry`
        );
      }
    }
  }
  return violations;
}

// ─── The walker ──────────────────────────────────────────────────────────────

describe("#5599 PR-C G7 — static walker: every production emitEvent call site is transaction-disciplined", () => {
  const files = productionSourceFiles();
  const fileSource = new Map(files.map((f) => [rel(f), fs.readFileSync(f, "utf8")] as const));

  const allEmitSites: EmitCallSite[] = [];
  for (const [file, source] of fileSource) {
    allEmitSites.push(...findCallSites(source, file, "emitEvent"));
  }

  it("finds the emitEvent surface at all (walker liveness — an empty scan is a broken walker, not a clean repo)", () => {
    // The engine + 18 routes + the cron surfaces emit; if this walker ever
    // sees fewer than 30 sites, its enumeration or matcher broke.
    expect(allEmitSites.length).toBeGreaterThan(30);
    expect(fileSource.has("lib/db.ts")).toBe(true);
  });

  it("every call site is (a) on a transaction callback's tx, (b) an inventoried caller-threaded db, or (c) annotated mock-only", () => {
    const violations = classifyViolations(allEmitSites, fileSource, { fullCensus: true });
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("in every EMITTING file, `tx` can only name an in-transaction client — no rebinding (one known exception, which IS one)", () => {
    // Scoped to the files where `tx` is interpreted by rule (a): files with an
    // emitEvent call site, plus lib/db.ts (where the convention originates).
    // Unrelated `tx` identifiers elsewhere (e.g. a UI page rendering fuel
    // transactions) are none of this walker's business.
    const emittingFiles = new Set([...allEmitSites.map((s) => s.file), "lib/db.ts"]);
    const bindings: string[] = [];
    for (const file of emittingFiles) {
      const code = blankComments(fileSource.get(file) ?? "");
      for (const match of code.matchAll(/\b(?:const|let|var)\s+tx\b/g)) {
        bindings.push(`${file}:${lineAt(code, match.index)}`);
      }
    }
    // The single allowed binding: createTransactionScopedClient's own
    // `const tx: DbClient = {` — the object it builds IS the in-transaction
    // client, so the convention holds there by construction.
    expect(bindings, bindings.join("\n")).toHaveLength(1);
    expect(bindings[0]).toMatch(/^lib\/db\.ts:\d+$/);
    const dbSource = fileSource.get("lib/db.ts") ?? "";
    expect(dbSource).toContain("function createTransactionScopedClient");
    expect(dbSource).toContain("const tx: DbClient = {");
  });

  it("every production caller of a db-threaded helper passes the transaction callback's tx", () => {
    const failures: string[] = [];
    for (const entry of THREADED_HELPER_EMIT_CENSUS) {
      for (const helper of entry.helpers) {
        const callSites: EmitCallSite[] = [];
        for (const [file, source] of fileSource) {
          callSites.push(...findCallSites(source, file, helper));
        }
        if (callSites.length === 0) {
          failures.push(`${helper} (${entry.definedIn}) has NO production callers — stale census entry`);
        }
        for (const call of callSites) {
          if (call.firstArg !== "tx") {
            failures.push(
              `${call.file}:${call.line} calls ${helper}(${call.firstArg}, …) — this helper emits on its ` +
                `db parameter, so every caller must pass a transaction callback's tx (wrap in withTransaction)`
            );
            continue;
          }
          const callerSource = fileSource.get(call.file) ?? "";
          if (!TX_WRAPPER_MARKERS.some((m) => callerSource.includes(m))) {
            failures.push(
              `${call.file}:${call.line} calls ${helper}(tx, …) but the file never opens a transaction — ` +
                `nothing in scope can have bound tx to an in-transaction client`
            );
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // ── The guard can actually fail (DoD (b): demonstrate the violating shape) ──
  describe("walker self-test: the violating shapes ARE caught", () => {
    it("flags an emitEvent call on a pooled client in a route-shaped file", () => {
      const sites = findCallSites(
        `import { getDb, emitEvent } from "@/lib/db";\n` +
          `export async function POST() {\n` +
          `  const db = await getDb();\n` +
          `  await db.execute("UPDATE topics SET status = 'open'");\n` +
          `  await emitEvent(db, "t", "pact.topic.approved");\n` +
          `}\n`,
        "app/api/synthetic/route.ts",
        "emitEvent"
      );
      const violations = classifyViolations(sites, new Map([["app/api/synthetic/route.ts", ""]]), {
        fullCensus: false,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("app/api/synthetic/route.ts");
      expect(violations[0]).toContain("not in THREADED_HELPER_EMIT_CENSUS");
    });

    it("flags a tx-named call in a file that never opens a transaction", () => {
      const file = "app/api/synthetic2/route.ts";
      const source = `const tx = poolClient;\nawait emitEvent(tx, "t", "pact.topic.approved");\n`;
      const sites = findCallSites(source, file, "emitEvent");
      const violations = classifyViolations(sites, new Map([[file, source]]), { fullCensus: false });
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("never opens a transaction");
    });

    it("flags any other first argument outright", () => {
      const file = "lib/synthetic.ts";
      const source = `await emitEvent(scoped, "t", "pact.topic.approved");\n`;
      const violations = classifyViolations(findCallSites(source, file, "emitEvent"), new Map([[file, source]]), {
        fullCensus: false,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("emitEvent(scoped, …)");
    });

    it("does NOT count comments or prose strings as call sites, and honours the mock-only annotation", () => {
      const file = "lib/synthetic2.ts";
      const source =
        `// await emitEvent(db, "t", "pact.topic.approved")\n` +
        `const prose = "route handlers call emitEvent outside any transaction";\n` +
        `await emitEvent(mock, "t", "pact.topic.approved"); // #5599 mock-only: two-method harness stub\n`;
      const sites = findCallSites(source, file, "emitEvent");
      expect(sites).toHaveLength(1);
      expect(sites[0].mockOnly).toBe(true);
      expect(classifyViolations(sites, new Map([[file, source]]), { fullCensus: false })).toEqual([]);
    });
  });
});

// ─── Unit pins on the runtime interlock (the actual closure) ─────────────────

describe("#5599 PR-C — the chain-append interlock (unit pins on the three-branch condition)", () => {
  const sentinel = new Error("append-attempted");

  function recordingClient(overrides: Partial<DbClient> & { inTransaction?: boolean }): {
    client: DbClient;
    calls: string[];
  } {
    const calls: string[] = [];
    const client: DbClient = {
      execute: async (stmt) => {
        calls.push(typeof stmt === "string" ? stmt : stmt.sql);
        throw sentinel; // stop appendChainedEvent at its first statement
      },
      batch: async () => {
        calls.push("batch");
        throw sentinel;
      },
      ...overrides,
    };
    return { client, calls };
  }

  it("POOLED SHAPE (has .transaction, NOT in one): throws ChainAppendError before touching the database", async () => {
    let secondTransactionOpened = false;
    const { client, calls } = recordingClient({
      transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => {
        secondTransactionOpened = true;
        return fn(client);
      },
    });
    await expect(emitEvent(client, "topic-x", "pact.topic.stable")).rejects.toThrow(ChainAppendError);
    expect(secondTransactionOpened).toBe(false); // the old branch is GONE, not rerouted
    expect(calls).toEqual([]); // refused before any statement ran
  });

  it("the error is named, and its message points at #5599 and the wrapping APIs", async () => {
    const { client } = recordingClient({
      transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(client),
    });
    const err = await emitEvent(client, "topic-x", "pact.topic.stable").then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ChainAppendError);
    expect((err as ChainAppendError).name).toBe("ChainAppendError");
    expect((err as ChainAppendError).message).toContain("#5599");
    expect((err as ChainAppendError).message).toContain("withTransaction");
    expect((err as ChainAppendError).message).toContain("topic-x");
  });

  it("IN-TRANSACTION SHAPE: appends directly on the SAME client — no nested transaction", async () => {
    let nestedTransaction = false;
    const { client, calls } = recordingClient({
      inTransaction: true,
      transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => {
        nestedTransaction = true;
        return fn(client);
      },
    });
    await expect(emitEvent(client, "topic-x", "pact.topic.stable")).rejects.toThrow(sentinel.message);
    expect(nestedTransaction).toBe(false);
    expect(calls.length).toBeGreaterThan(0); // the append was attempted, not refused
  });

  it("MOCK SHAPE (no .transaction at all): appends directly — the mock suite's two-method clients keep working", async () => {
    const { client, calls } = recordingClient({});
    await expect(emitEvent(client, "topic-x", "pact.topic.stable")).rejects.toThrow(sentinel.message);
    expect(calls.length).toBeGreaterThan(0);
  });
});
