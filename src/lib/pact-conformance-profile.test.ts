import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildPactProfile } from "./pact-profile";
import type { RetentionPolicy } from "./pact-profile";
import { UNCHAINED_EVENTS_PURGED, UNCHAINED_EVENT_RETENTION_DAYS } from "./retention";

/**
 * THE DOCUMENT/WIRE INTERLOCK for §6.3 retention (#5598).
 *
 * `PACT_CONFORMANCE.md` is the human-readable conformance profile; the
 * `/.well-known/pact.json` document built by `buildPactProfile()` is the
 * machine-readable one. They are two renderings of one claim, and #5541 found
 * the failure mode that follows from having two: the Markdown drifted, nobody
 * noticed, and a reader who trusted it was misinformed by a file that looked
 * maintained.
 *
 * #5598 is that same failure one layer down — the served `retentionPolicy`
 * said `{ minimumDays: 0, indefinite: true }` while a daily job hard-deleted
 * event rows. The fix derives the wire from the enforcing constants
 * (`pact-profile.test.ts` guards that derivation). This file closes the
 * remaining hole: prose in the Markdown that contradicts the wire.
 *
 * ## Why this lives here and not in the document
 *
 * `PACT_CONFORMANCE.md` is owned by PR #5578 (#5541) and is deliberately NOT
 * edited by #5598. Putting the check in a test rather than in the prose makes
 * the contradiction UNMERGEABLE rather than merely noticed: #5578 may say
 * whatever it likes about retention, provided what it says is what the server
 * serves.
 *
 * **This is expected to turn PR #5578 red until its retention prose is
 * updated. That is the intended effect, and it was signed off as such.** The
 * document as it stands (v1.1, April 2026) states nothing about retention at
 * all, so this suite is green today; it bites the moment a number appears.
 *
 * ## Tolerant in shape, strict in substance
 *
 * The Markdown is prose. A test demanding an exact sentence would repeat the
 * mistake of pinning the stale §6.4 gap text — green until someone rewords
 * it, then red for no reason. So the extraction below is deliberately narrow:
 * it looks only at statements that are BOTH about the event log AND about
 * retention, and it only ever compares numbers. The cleanup route's other
 * schedules (90-day proposals, 90-day registrations) are not described by
 * `retentionPolicy` and are explicitly not the subject here.
 *
 * ## Every check is proven able to fail
 *
 * The extraction is a pure function over a string, so the last test in this
 * file runs it against known-BAD fixtures and asserts each one throws, plus a
 * known-GOOD fixture that must not. That is what stops this suite becoming
 * the guard it was written to replace — one that passed because it never
 * actually looked at anything.
 */

const SOURCE_ROOT = path.resolve(__dirname, "..", "..");
const CONFORMANCE_DOC = path.join(SOURCE_ROOT, "PACT_CONFORMANCE.md");

const served = buildPactProfile().retentionPolicy;

/** Statements about the EVENT LOG — not proposals, tokens or registrations. */
const ABOUT_EVENTS = /\bevents?\b|\bevent log\b/i;

/** Statements about RETENTION — not about events generally. */
const ABOUT_RETENTION = /\bretain|\bretention|\bpurg|\bdelet|\btombston|\bexpir/i;

/** A day figure: `30 days`, `30-day`, `30day`. */
const DAY_FIGURE = /(\d+)[\s-]?days?\b/gi;

/**
 * Sentences that DENY an event-log deletion path. Each is a literal shape the
 * false claim actually took, or the obvious rewording of it — narrow on
 * purpose, because "chained rows are retained indefinitely" is a TRUE
 * sentence about half the log and must not trip anything.
 */
const PURGE_DENIALS: readonly RegExp[] = [
  /holds no (?:purge|expiry|tombstone)/i,
  /no (?:purge|expiry|delete|deletion|tombstone) (?:path|mechanism)/i,
  /events? (?:are|is) never (?:deleted|purged|removed|expired)/i,
  /event log is (?:retained|kept) (?:forever|indefinitely)/i,
  /nothing (?:deletes|purges|removes) events/i,
];

/** What the Markdown STATES about event retention, extracted structurally. */
interface StatedRetention {
  /** Every `"retentionPolicy": { … }` object the document declares. */
  readonly declaredPolicies: Record<string, unknown>[];
  /** Day figures, grouped by the statement that carried them. */
  readonly statedDayFigures: number[][];
  /** Statements denying that any event-log deletion path exists. */
  readonly purgeDenials: string[];
}

/**
 * Pure extractor — no assertions, no filesystem. Split out so the fixtures at
 * the bottom of this file can prove each check bites.
 *
 * `retentionPolicy` is a flat object of scalars, so a non-nested `{…}` match
 * is sufficient and avoids hand-rolling a brace matcher over prose.
 */
function readStatedRetention(markdown: string): StatedRetention {
  const declaredPolicies: Record<string, unknown>[] = [];
  for (const match of markdown.matchAll(/"retentionPolicy"\s*:\s*\{[^{}]*\}/g)) {
    const parsed = JSON.parse(`{${match[0]}}`) as { retentionPolicy: Record<string, unknown> };
    declaredPolicies.push(parsed.retentionPolicy);
  }

  const statedDayFigures: number[][] = [];
  const purgeDenials: string[] = [];
  // Sentence-ish granularity, not line granularity: a Markdown paragraph is
  // one line, and a paragraph may legitimately mention the 90-day proposal
  // schedule in a different sentence from the event-log bound.
  for (const statement of markdown.split(/(?<=[.!?])\s+|\n/)) {
    if (!ABOUT_EVENTS.test(statement)) continue;
    if (!ABOUT_RETENTION.test(statement)) continue;
    const figures = [...statement.matchAll(DAY_FIGURE)].map((m) => Number(m[1]));
    if (figures.length > 0) statedDayFigures.push(figures);
    if (PURGE_DENIALS.some((pattern) => pattern.test(statement))) purgeDenials.push(statement);
  }

  return { declaredPolicies, statedDayFigures, purgeDenials };
}

/** Asserts the extracted claims against the served policy. Throws on mismatch. */
function assertStatedRetentionMatches(stated: StatedRetention, policy: RetentionPolicy): void {
  const wire = policy as unknown as Record<string, unknown>;

  // 1. A declared machine-readable block must BE the served block, key for
  // key. Per-key rather than deep-equal, so an abbreviated excerpt may omit a
  // field — but never state a different value for one.
  for (const declared of stated.declaredPolicies) {
    for (const [key, value] of Object.entries(declared)) {
      expect(Object.keys(wire)).toContain(key);
      expect(value).toEqual(wire[key]);
    }
  }

  // 2. Any statement giving a day bound for the event log must include the
  // bound actually enforced. Other figures may sit in the same sentence (the
  // cleanup route's 90-day schedules are legitimately mentioned in scope
  // notes); a sentence that gives a bound and omits the real one is stating a
  // retention period this server does not honour.
  for (const figures of stated.statedDayFigures) {
    expect(figures).toContain(policy.minimumDays);
  }

  // 3. While a hard-delete path is live, the document may not deny one.
  if (UNCHAINED_EVENTS_PURGED) {
    expect(stated.purgeDenials).toEqual([]);
  }
}

describe("PACT_CONFORMANCE.md — the document may not contradict the wire (§6.3)", () => {
  it("the document is where the interlock expects it", () => {
    // If #5578 moves or renames this file, red is the correct outcome: the
    // interlock has lost its subject and must be re-pointed deliberately.
    expect(fs.existsSync(CONFORMANCE_DOC)).toBe(true);
  });

  it("states no retention number that differs from the served retentionPolicy", () => {
    const markdown = fs.readFileSync(CONFORMANCE_DOC, "utf8");
    assertStatedRetentionMatches(readStatedRetention(markdown), served);
  });

  it("the served policy this is measured against is the enforcing constant", () => {
    // Guards the interlock's own reference point. Compared against a literal
    // typed here, the two files could agree with each other and both be wrong
    // about the code.
    expect(served.minimumDays).toBe(UNCHAINED_EVENT_RETENTION_DAYS);
    expect(served.indefinite).toBe(!UNCHAINED_EVENTS_PURGED);
  });

  it("every check in this file can actually fail", () => {
    // Fixture figures are DERIVED from the served policy, never typed. A
    // literal `0` here would quietly stop being a contradiction on the day
    // someone set the real bound to 0 — which is the exact class of dead
    // guard this whole change exists to remove.
    const wrongDays = served.minimumDays + 60;

    // A contradicting machine-readable block — the shape that was served,
    // falsely, before #5598.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(
          '```json\n{ "retentionPolicy": ' +
            `{ "minimumDays": ${wrongDays}, "indefinite": ${!served.indefinite} }` +
            " }\n```"
        ),
        served
      )
    ).toThrow();

    // A contradicting prose bound.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(`Events are purged ${wrongDays} days after creation.`),
        served
      )
    ).toThrow();

    // A denial of the purge path — the §6.3 gap's own pre-#5598 wording.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(
          "The implementation holds no purge, expiry or tombstone path for the event log."
        ),
        served
      )
    ).toThrow();

    // ...and the shapes that must NOT trip it: the true half of the split,
    // and a schedule `retentionPolicy` does not describe.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(
          "Chained event rows are retained indefinitely. " +
            `Unchained event rows are hard-deleted ${served.minimumDays} days after ` +
            "creation. " +
            `Resolved proposals are deleted after ${wrongDays} days.`
        ),
        served
      )
    ).not.toThrow();
  });
});
