/**
 * #5564 / #5565 — invariants of the declared epistemics mappings.
 *
 * The load-bearing enforcement for "an op the map does not cover cannot be
 * emitted" is the TYPECHECKER: `emitEvent`'s `type` parameter is
 * `EmittedPactOp = keyof typeof PACT_EVENT_MAP`, so `npx tsc --noEmit` and
 * `npm run build` fail on an undeclared op. What this suite pins is the
 * durability of that enforcement (the signature stays narrowed, no cast
 * reopens the hole) plus the semantic invariants of the tables themselves —
 * completeness over the seven §10 events, reasons on every out-of-scope op,
 * and every op literal at an emit site actually being a declared key.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  EPISTEMICS_EVENTS,
  EPISTEMICS_FIELD_MAP,
  PACT_EVENT_MAP,
  UNIMPLEMENTED_EPISTEMICS_EVENTS,
  epistemicsEventMappingAdvertisement,
  epistemicsFieldMappingAdvertisement,
  type EmittedPactOp,
} from "./epistemics-mapping";

const SRC_ROOT = path.join(__dirname, "..");

/** Every non-test .ts source file under src/, read once. */
function sourceFiles(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push({ file: path.relative(SRC_ROOT, full), text: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(SRC_ROOT);
  return out;
}

describe("PACT_EVENT_MAP — classification invariants (#5565)", () => {
  const ops = Object.keys(PACT_EVENT_MAP) as EmittedPactOp[];

  it("classifies a non-trivial inventory, every op a pact.* name", () => {
    // ~40 product ops exist today; a collapse of the table to a handful
    // means someone replaced the inventory instead of maintaining it.
    expect(ops.length).toBeGreaterThanOrEqual(40);
    for (const op of ops) expect(op).toMatch(/^pact\.[a-z0-9._-]+$/);
  });

  it("every entry is either mapped to a §10 event or out-of-extension WITH a reason", () => {
    for (const op of ops) {
      const c = PACT_EVENT_MAP[op];
      if (c.scope === "epistemics") {
        expect(EPISTEMICS_EVENTS).toContain(c.event);
      } else {
        expect(c.scope).toBe("out-of-extension");
        // A reason is the price of the exemption — never an empty string.
        expect(c.reason.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("no existing event name changed: the known production ops are still keys", () => {
    // #5565 DoD — mapping, NOT renaming. The ops the issue names as the
    // case the escape hatch exists for must stay on the wire verbatim.
    for (const op of [
      "pact.topic.consensus-reached",
      "pact.consensus.broken",
      "pact.topic.stable",
      "pact.stable.broken",
      "pact.consensus.blocked-by-dependencies",
      "pact.consensus.challenged",
      "pact.challenge.lapsed",
      "pact.challenge.dismissed-vexatious",
    ]) {
      expect(ops).toContain(op);
    }
    // And no pact.epistemics.* op is EMITTED — the extension vocabulary
    // exists on the wire only as the declared mapping, never as a rename.
    expect(ops.filter((op) => op.startsWith("pact.epistemics."))).toEqual([]);
  });
});

describe("§10 coverage — every one of the seven events is mapped or declared (#5565)", () => {
  const mapping = epistemicsEventMappingAdvertisement();

  it("covers all seven, mapped XOR unimplemented-with-reason", () => {
    expect(Object.keys(mapping).sort()).toEqual([...EPISTEMICS_EVENTS].sort());
    for (const eventName of EPISTEMICS_EVENTS) {
      const entry = mapping[eventName];
      if ("unimplemented" in entry) {
        expect(entry.unimplemented.trim().length).toBeGreaterThan(20);
        // An unimplemented declaration over an op that DOES map to the event
        // would be a contradiction on the wire.
        for (const op of Object.keys(PACT_EVENT_MAP) as EmittedPactOp[]) {
          const c = PACT_EVENT_MAP[op];
          expect(!(c.scope === "epistemics" && c.event === eventName)).toBe(true);
        }
      } else {
        expect(entry.productOps.length).toBeGreaterThan(0);
      }
    }
  });

  it("challenge-reopened is the declared shortfall, with the shared-op reason", () => {
    const entry = mapping["pact.epistemics.challenge-reopened"];
    expect("unimplemented" in entry).toBe(true);
    expect(UNIMPLEMENTED_EPISTEMICS_EVENTS["pact.epistemics.challenge-reopened"]).toMatch(
      /pact\.consensus\.challenged/
    );
  });

  it("the advertisement is derived fresh per call (no module aliasing)", () => {
    const again = epistemicsEventMappingAdvertisement();
    expect(again).toEqual(mapping);
    expect(Object.is(again, mapping)).toBe(false);
    const fields = epistemicsFieldMappingAdvertisement();
    expect(fields).toEqual(epistemicsFieldMappingAdvertisement());
    expect(Object.is(fields[0].routes, EPISTEMICS_FIELD_MAP[0].routes)).toBe(false);
  });
});

describe("emitEvent narrowing stays load-bearing (#5565)", () => {
  const files = sourceFiles();
  const dbSource = files.find((f) => f.file.replace(/\\/g, "/") === "lib/db.ts")!.text;

  it("emitEvent's type parameter is EmittedPactOp, not string", () => {
    // Widen this back to `type: string` and adding an unmapped op stops
    // breaking the build — which is the #5565 DoD this signature carries.
    expect(dbSource).toMatch(
      /export async function emitEvent\(\s*db: DbClient,\s*topicId: string,\s*type: EmittedPactOp,/
    );
  });

  it("no source file casts its way past the union", () => {
    // `as EmittedPactOp[]` over Object.keys(PACT_EVENT_MAP) inside the
    // mapping module itself is the one legitimate shape (keys of the map ARE
    // the union); a scalar `as EmittedPactOp` anywhere is the escape hatch
    // that would let an undeclared op through the narrowed signature.
    for (const { file, text } of files) {
      expect(/as EmittedPactOp(?!\[)/.test(text), `${file} casts to EmittedPactOp`).toBe(false);
    }
  });

  it("every string-literal op at an emitEvent call site is a declared key", () => {
    const keys = new Set<string>(Object.keys(PACT_EVENT_MAP));
    let literalsSeen = 0;
    for (const { file, text } of files) {
      if (!text.includes("emitEvent(")) continue;
      for (const line of text.split("\n")) {
        if (!line.includes("emitEvent(")) continue;
        for (const match of line.matchAll(/"(pact\.[a-z0-9._-]+)"/g)) {
          literalsSeen++;
          expect(keys.has(match[1]), `${file}: emitEvent op ${match[1]} not in PACT_EVENT_MAP`).toBe(
            true
          );
        }
        // The one templated emitter: pact.topic.vote.${voteType}. All of its
        // expansions must be declared keys.
        if (/`pact\.topic\.vote\.\$\{/.test(line)) {
          for (const suffix of ["approve", "reject", "need_info"]) {
            expect(keys.has(`pact.topic.vote.${suffix}`)).toBe(true);
          }
        }
      }
    }
    // The scan actually saw the emitters — an accidentally-empty walk must
    // not read as coverage.
    expect(literalsSeen).toBeGreaterThanOrEqual(25);
  });
});
