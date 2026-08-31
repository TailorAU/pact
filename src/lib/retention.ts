/**
 * §6.3 retention — the PURE seam between what the store actually deletes and
 * what it advertises (#5598, epic #5488).
 *
 * ## Why this module exists at all
 *
 * Before #5598 the 30-day bound lived as a bare `INTERVAL '30 days'` literal
 * inside the cron route, and `pact-profile.ts` hand-typed the advertisement
 * next to it as `{ minimumDays: 0, indefinite: true }`. Nothing connected the
 * two, so the served `/.well-known/pact.json` claimed the event log was never
 * purged while a daily job purged it. The advertisement was not stale — it was
 * never derived from anything in the first place.
 *
 * So the constant and the statement that enforces it now live in ONE place,
 * and the advertisement is computed from them:
 *
 *   RETENTION_POLICY.minimumDays    = UNCHAINED_EVENT_RETENTION_DAYS
 *   RETENTION_POLICY.indefinite     = !UNCHAINED_EVENTS_PURGED
 *   RETENTION_POLICY.tombstoneAfter = PURGE_IS_TOMBSTONE ? … : null
 *
 * Switch the purge off, or convert it to a tombstone, and the wire moves by
 * itself. A guard in `pact-profile.test.ts` asserts that equality, so a future
 * author who re-hardcodes `minimumDays` goes red.
 *
 * ## The hard constraint: ZERO database imports
 *
 * This module MUST NOT import from `./db`, `./pact-profile`, `pg`, `next/*`,
 * or anything under `src/app/`. It builds SQL *strings*; it never executes
 * one. Two independent reasons:
 *
 *  1. `pact-profile.ts` imports this module, and `pact-profile.test.ts` calls
 *     `buildPactProfile()` at MODULE SCOPE. Any transitive import of `db.ts`
 *     would construct a `pg.Pool` from `process.env.DATABASE_URL` at
 *     test-collection time.
 *  2. The profile's whole point is that it can be built without a database.
 *     Importing the cron route (which carries `export const dynamic` and calls
 *     `getDb()`) to reach the purge SQL would destroy that property — which is
 *     precisely why the SQL moved HERE rather than being imported from there.
 *
 * Import direction is one-way and must stay that way:
 *
 *   cleanup/route.ts ─┐
 *   db.ts ────────────┼──▶ retention.ts   (retention.ts imports nothing back)
 *   pact-profile.ts ──┘
 *
 * ## The three SQL traps this codebase fails silently on
 *
 * **`pgify` (`db.ts:163-168`)** rewrites every `?` to `$n` AND double-quotes
 * any camelCase identifier (`/\b([a-z][a-zA-Z]*[A-Z]\w*)\b/g` → `"$1"`). The
 * regex fires only on a token that starts lowercase and later contains an
 * uppercase letter with no underscore in between — `[a-zA-Z]*` cannot cross
 * `_`. So every identifier and alias in this file is snake_case, every keyword
 * is uppercase, and the only `?` characters in any statement below are
 * parameter placeholders. An alias like `purgedCount` would be emitted as
 * `"purgedCount"` and Postgres would then demand that exact case exist.
 *
 * **`rowsAffected` on a data-modifying CTE reports the OUTER SELECT.** For
 * {@link buildUnchainedEventPurge} that is a single one-row `SELECT`, so
 * `rowsAffected === 1` no matter how many events were deleted. Read the counts
 * out of `rows[0]` via {@link readUnchainedPurgeResult} — the only sanctioned
 * reader. (`db.ts:120` installs `pg.types.setTypeParser(20, Number)`, so int8
 * arrives as a JS number, not a string; the reader still `Number()`-wraps.)
 *
 * **An UNTYPED literal in a `SELECT DISTINCT` (or `GROUP BY`) target list is
 * resolved to `text` BEFORE the INSERT's assignment coercion runs.** Postgres
 * needs a sort/equality operator for every DISTINCT column, so
 * `addTargetToGroupList` coerces each remaining UNKNOWN-typed entry to `text`
 * during parse analysis. Only then does `transformInsertStmt` try to assign the
 * sub-select's columns to the target columns — and `text → timestamptz` has no
 * assignment cast. So
 *
 *   INSERT INTO resource_chain_meta (…, last_purged_at, …)
 *   SELECT DISTINCT topic_id, 0, NOW(), NULL, ?     -- ← bare NULL
 *
 * fails at parse time with `column "last_purged_at" is of type timestamp with
 * time zone but expression is of type text`. Without the `DISTINCT` the very
 * same statement is accepted, which is what makes this one silent: the shape
 * looks ordinary and the repo's in-memory test double never parses SQL. Every
 * NULL (and every untyped literal) under a DISTINCT in this file therefore
 * carries an explicit `::TYPE` cast. All-lowercase and all-uppercase type names
 * both survive `pgify` — its regex needs a lowercase-then-uppercase token.
 *
 * `provenance-chain.ts` § Genesis explains what the latch is FOR.
 */

/**
 * The §6.3 bound on UNCHAINED (pre-#5566) event rows, in days.
 *
 * This is the ONE definition of the retention floor. It is bound into the
 * purge statement as a parameter (`make_interval(days => ?)`) and served as
 * `retentionPolicy.minimumDays`, so the enforced bound and the advertised
 * bound cannot drift.
 *
 * It applies to unchained rows ONLY. Chained rows (§6.4, everything written
 * since #5566) are retained indefinitely — see
 * {@link CHAINED_EVENTS_RETAINED_INDEFINITELY}.
 */
export const UNCHAINED_EVENT_RETENTION_DAYS: number = 30;

/**
 * True while an active hard-delete path exists for unchained event rows.
 *
 * The advertisement reads `indefinite: !UNCHAINED_EVENTS_PURGED`. Flip this to
 * `false` only when the purge is genuinely gone from the cron — the guard in
 * `pact-profile.test.ts` compares the served policy against these constants,
 * not against the code, so lying here moves the wire without moving reality.
 */
export const UNCHAINED_EVENTS_PURGED: boolean = true;

/**
 * False — the purge hard-deletes; it does not tombstone in place.
 *
 * Tombstoning would be strictly better (it would make the
 * `resource_chain_meta` latch unnecessary, because the evidence would survive
 * as a row), but it changes what the public events feed returns to every
 * consumer, so it is its own design and explicitly out of scope for #5598.
 * Recorded here so the advertisement states the real mechanism rather than the
 * flattering one.
 */
export const PURGE_IS_TOMBSTONE: boolean = false;

/**
 * True — CHAINED rows are retained indefinitely, and §6.4 forbids deleting
 * them.
 *
 * A sequence number is never reused, reassigned or skipped; a compacted event
 * retains its chain position. Removing a chained row punches a permanent,
 * unrecoverable gap that every verifier correctly reads as evidence of
 * tampering. That is why the purge below is predicated on
 * `sequence_number IS NULL` and stops at the chain.
 */
export const CHAINED_EVENTS_RETAINED_INDEFINITELY: boolean = true;

/**
 * `resource_chain_meta` — the durable evidence table the purge stamps — is
 * deliberately NOT exported as a string constant.
 *
 * A row means "this resource DID have unchained history". Absence means
 * UNKNOWN — never "it had none". That asymmetry is the entire fix in #5598,
 * and it only holds while the latch is monotonic (`false → true`, never back),
 * so no code anywhere may remove a row from this table. Guard G4 in
 * `provenance-chain.test.ts` enforces that by scanning source for a delete
 * against the LITERAL table name — so an exported constant would be a
 * ready-made bypass: `DELETE FROM ${RESOURCE_CHAIN_META_TABLE}` matches no
 * text guard. #5598 shipped that constant unused; it is removed rather than
 * kept "for tidiness", because its only possible use was the evasion. Write
 * the table name out in full, and G4 can see you.
 */

/**
 * Frozen `resource_chain_meta.origin` vocabulary — exactly three values.
 *
 * `origin` records WHICH writer first latched a resource, and is immutable
 * after insert (the purge's `ON CONFLICT DO UPDATE` deliberately omits it).
 * Overwriting it with `purge` on the day the purge runs would erase the fact
 * that we already knew earlier.
 */
/** Latched at the moment its rows were deleted, by the purge CTE itself. */
export const CHAIN_META_ORIGIN_PURGE = "purge";
/** Latched from a live unchained row by the daily pre-pass, ahead of the bound. */
export const CHAIN_META_ORIGIN_PRE_PURGE_SWEEP = "pre-purge-sweep";
/** Latched from a live unchained row by the one-shot #5598 backfill in `db.ts`. */
export const CHAIN_META_ORIGIN_BACKFILL = "backfill";

export type ChainMetaOrigin =
  | typeof CHAIN_META_ORIGIN_PURGE
  | typeof CHAIN_META_ORIGIN_PRE_PURGE_SWEEP
  | typeof CHAIN_META_ORIGIN_BACKFILL;

/**
 * `sweep_state.key` latching the one-shot #5598 backfill (`db.ts`, run once at
 * the end of `initSchema`).
 *
 * The backfill runs FIRST and writes this key SECOND, so a throw leaves the
 * key absent and the next cold start retries. Latch-then-backfill would skip
 * it forever, silently.
 */
export const CHAIN_META_BACKFILL_SWEEP_KEY = "chain_meta_backfill_5598";

/** A parameterised statement in the shape `DbClient.execute` accepts. */
export interface RetentionStatement {
  readonly sql: string;
  readonly args: unknown[];
}

/**
 * Counts read OUT OF `rows[0]` — never off `rowsAffected`, which on the purge
 * CTE reports the outer one-row SELECT and is therefore always 1.
 */
export interface UnchainedPurgeResult {
  readonly eventsDeleted: number;
  readonly resourcesStamped: number;
}

/**
 * The one data-modifying CTE that deletes expired unchained event rows and
 * stamps `resource_chain_meta` in the SAME statement.
 *
 * ONE statement ⇒ no observable intermediate. Every sub-statement of a
 * data-modifying CTE runs against a single snapshot, so there is no instant at
 * which a concurrent reader can see the DELETE without the stamp — and no
 * window in which a crash between two separate statements would destroy the
 * rows without recording that they existed. That window is the whole reason
 * this is a CTE and not a transaction of two statements.
 *
 * Structure, and why each part is load-bearing:
 *
 *  - `sequence_number IS NULL` — the purge stops at the chain (§6.4). Dropping
 *    this predicate would shred chained rows and forge tampering evidence.
 *  - `aggregated` / `GROUP BY` — NOT cosmetic. `deleted` returns one row per
 *    deleted event, so a resource with 40 purged events would present 40 rows
 *    with the same conflict key and Postgres would raise "ON CONFLICT DO
 *    UPDATE command cannot affect row a second time". Removing the GROUP BY
 *    does not degrade this statement, it makes it throw.
 *  - `+ EXCLUDED.unchained_purged_count` — accumulates across daily runs
 *    instead of overwriting; a resource can be purged on more than one day.
 *  - the `DO UPDATE SET` list omits `first_observed_at` and `origin` — both
 *    are immutable after insert, or the daily job would rewrite the evidence's
 *    provenance to "today, by the purge".
 *  - `RETURNING topic_id` from `stamped` counts inserted AND updated rows,
 *    i.e. distinct resources touched, which is what `resources_stamped` means.
 *  - `make_interval(days => ?)` rather than `INTERVAL '30 days'` — the bound
 *    is a parameter fed from {@link UNCHAINED_EVENT_RETENTION_DAYS}, so the
 *    advertised policy and the enforced one are the same number. A
 *    string-interpolated interval would be both an injection surface and an
 *    un-derivable literal.
 *
 * `retentionDays` defaults to {@link UNCHAINED_EVENT_RETENTION_DAYS}. The
 * parameter exists so a test can assert placeholder wiring with a different
 * bound — NOT so production can vary the advertised floor.
 *
 * Read the result with {@link readUnchainedPurgeResult}.
 */
export function buildUnchainedEventPurge(
  retentionDays: number = UNCHAINED_EVENT_RETENTION_DAYS
): RetentionStatement {
  return {
    sql: `WITH deleted AS (
  DELETE FROM events
  WHERE sequence_number IS NULL
    AND created_at < NOW() - make_interval(days => ?)
  RETURNING topic_id
),
aggregated AS (
  SELECT topic_id, COUNT(*) AS purged_count
  FROM deleted
  GROUP BY topic_id
),
stamped AS (
  INSERT INTO resource_chain_meta (
    topic_id, unchained_purged_count, first_observed_at, last_purged_at, origin
  )
  SELECT topic_id, purged_count, NOW(), NOW(), ?
  FROM aggregated
  ON CONFLICT (topic_id) DO UPDATE
    SET unchained_purged_count =
          resource_chain_meta.unchained_purged_count + EXCLUDED.unchained_purged_count,
        last_purged_at = EXCLUDED.last_purged_at
  RETURNING topic_id
)
SELECT
  (SELECT COUNT(*) FROM deleted) AS events_deleted,
  (SELECT COUNT(*) FROM stamped) AS resources_stamped`,
    args: [retentionDays, CHAIN_META_ORIGIN_PURGE],
  };
}

/**
 * The pre-pass / backfill stamp: latch every resource that CURRENTLY has an
 * unchained row, deleting nothing.
 *
 * Run it ahead of {@link buildUnchainedEventPurge} in the same cron tick with
 * origin `pre-purge-sweep`, and once from `db.ts` at migration time with origin
 * `backfill`. It asserts only "this resource has an unchained row right now" —
 * directly observable, invents no hash, touches no `events` row, idempotent.
 *
 * ## What this is NOT
 *
 * It is NOT what makes the genesis rule correct, and #5598 originally claimed
 * that it was. {@link buildUnchainedEventPurge} stamps the latch in the SAME
 * statement as the delete, so a resource whose pre-history is purged before it
 * ever appends its first chained event already reads `hadUnchainedHistory ===
 * true` and already writes `GENESIS-UNCHAINED`. The repo's own end-to-end
 * proof of that case (`provenance-chain.test.ts`, "Defect 2") seeds rows, runs
 * the purge ALONE with no pre-pass, then appends and asserts the sentinel. The
 * correctness of the genesis rule rests on the CTE's atomicity, not on this.
 *
 * What it actually buys is DIAGNOSTIC, and worth having on its own terms:
 *
 *  - `first_observed_at` records when the history was first known to exist,
 *    not merely the day it was destroyed;
 *  - `origin` distinguishes "we knew before the purge" from "we learned at the
 *    moment of deletion";
 *  - `last_purged_at IS NULL` is the only way to tell a sweep stamp from a
 *    purge stamp afterwards.
 *
 * Because it is diagnostic, a caller MUST NOT let a failure here abort the
 * purge (or anything else in the same job). `cleanup/route.ts` runs it inside
 * its own try/catch for exactly that reason.
 *
 *  - `ON CONFLICT DO NOTHING`, never `DO UPDATE`: the latch is PRESENCE-only.
 *    Re-stamping daily must not reset `unchained_purged_count`, must not move
 *    `first_observed_at`, and must not overwrite an earlier `origin`.
 *  - `SELECT DISTINCT` for the same conflict-key reason as `aggregated` above,
 *    and it keeps the INSERT source small.
 *  - `NULL::TIMESTAMPTZ`, never a bare `NULL`. `last_purged_at` is explicitly
 *    null — latched, nothing deleted yet — and the cast is MANDATORY, not
 *    style: under `DISTINCT` an untyped NULL resolves to `text` before the
 *    INSERT coercion and Postgres rejects the whole statement. See the third
 *    SQL trap in this file's header; a bare NULL here is what #5598 shipped,
 *    and it made both call sites throw on every run against a real database
 *    while the mock-backed suite stayed green.
 *  - The scan is a SEQUENTIAL scan of `events`, and no index changes that.
 *    `idx_events_topic_sequence` is `(topic_id, sequence_number)`, so a bare
 *    `sequence_number IS NULL` predicate has no leading-column qualifier to
 *    seek on — the planner reads the whole relation. That is acceptable
 *    because both callers are bounded (one-shot at migration; once a day) and
 *    both are fail-soft, but it is NOT the index-only scan #5598 claimed. Do
 *    not put this statement on a request path.
 *
 * Count the effect with `result.rows.length` (rows returned = rows actually
 * inserted). This one is a plain INSERT so `rowsAffected` would also be
 * correct — use `rows.length` anyway, so nobody has to remember which
 * statement in this module is which.
 */
export function buildUnchainedHistoryStamp(origin: ChainMetaOrigin): RetentionStatement {
  return {
    sql: `INSERT INTO resource_chain_meta (
  topic_id, unchained_purged_count, first_observed_at, last_purged_at, origin
)
SELECT DISTINCT topic_id, 0, NOW(), NULL::TIMESTAMPTZ, ?
FROM events
WHERE sequence_number IS NULL
ON CONFLICT (topic_id) DO NOTHING
RETURNING topic_id`,
    args: [origin],
  };
}

/**
 * Pre-flight sizing probe for the one-shot backfill: how many unchained rows
 * still exist to be latched.
 *
 * Worth logging once, because the number is time-boxed evidence. The retention
 * cron has been returning HTTP 308 since the 2026-07-02 domain cutover, so the
 * purge has never actually run and this count is still COMPLETE. Once the cron
 * is repaired (#5592) the count starts falling and the rows it counts become
 * permanently unverifiable.
 *
 * Same cost note as {@link buildUnchainedHistoryStamp}: a bare
 * `sequence_number IS NULL` predicate cannot seek on
 * `idx_events_topic_sequence (topic_id, sequence_number)`, so this is a
 * sequential scan of `events`. One-shot, behind the `sweep_state` latch, and
 * inside the same fail-soft try/catch as the stamp it sizes.
 *
 * Read it as `Number(rows[0]?.unchained_rows ?? 0)`.
 */
export function buildUnchainedRowCount(): RetentionStatement {
  return {
    sql: `SELECT COUNT(*) AS unchained_rows FROM events WHERE sequence_number IS NULL`,
    args: [],
  };
}

/**
 * Reads `events_deleted` / `resources_stamped` out of the purge CTE's single
 * row.
 *
 * The only sanctioned reader of that statement. Any caller that writes
 * `result.rowsAffected` into the cron's JSON has reintroduced the bug this
 * helper exists to prevent — the outer statement is a one-row SELECT, so the
 * response would report `1` deleted event forever.
 */
export function readUnchainedPurgeResult(
  rows: readonly Record<string, unknown>[]
): UnchainedPurgeResult {
  const row = rows[0];
  return {
    eventsDeleted: Number(row?.events_deleted ?? 0),
    resourcesStamped: Number(row?.resources_stamped ?? 0),
  };
}
