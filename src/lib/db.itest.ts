/**
 * #5599 B-0 — real-Postgres canaries pinning TODAY'S transaction semantics
 * of the Source KG database layer (src/lib/db.ts + src/lib/provenance-chain.ts).
 *
 * These tests are EXECUTABLE DOCUMENTATION of the dangerous semantics the
 * #5599 series (building on the #5566 provenance chain and the #5595/#5598
 * follow-ups) will change. Each canary asserts the CURRENT behaviour —
 * including behaviour that is a known flaw — so the PR that fixes a flaw
 * must consciously flip the corresponding assertion, and nothing underneath
 * the series can change silently.
 *
 * The mock suite (`npm test`) cannot cover any of this: transaction
 * abortion (SQLSTATE 25P02), the absence of savepoints, connection scoping,
 * and initSchema's real DDL are observable only against a real server.
 *
 * The suite runs ONLY when DATABASE_URL points at a real Postgres — the
 * `kg-integration` job in .github/workflows/source-pr-check.yml provides a
 * postgres:16-alpine service container. Without DATABASE_URL every canary
 * skips, loudly, so local mock-suite workflows are unaffected.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { DbClient } from "@/lib/db";
import type * as DbModule from "@/lib/db";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Loud, structured skip — the whole point of the guard is that a human
  // scanning local output can tell the canaries did NOT run, and why.
  // Raw stderr write, not console.warn: vitest intercepts console.* during
  // collection and drops it when no test in the file executes.
  process.stderr.write(
    "\n[db.itest] DATABASE_URL is not set — SKIPPING the real-Postgres KG canaries (#5599 B-0).\n" +
      "[db.itest] They run in CI against the kg-integration job's postgres:16-alpine service container.\n" +
      "[db.itest] To run locally: point DATABASE_URL at a disposable Postgres 16 database (it will be schema-bootstrapped).\n\n"
  );
}

const describeDb = DATABASE_URL ? describe : describe.skip;

/**
 * db.ts holds its pg.Pool in module-private state with no close/reset
 * export, and the idempotency canary below re-imports the module (a second
 * cold start), creating a second pool. To keep the vitest process from
 * dangling on idle sockets, we substitute a tracking subclass for pg.Pool
 * BEFORE db.ts is (dynamically) imported — `pg` is an externalized CJS
 * dependency, so db.ts's `const { Pool } = pg` destructure at module init
 * picks up whatever `pg.Pool` holds at that moment. afterAll ends every
 * tracked pool and restores the real constructor. Purely test-side — a
 * production-code close hook was deliberately NOT added (B-0 constraint:
 * db.ts gets zero edits).
 */
const RealPool = pg.Pool;
const trackedPools: InstanceType<typeof pg.Pool>[] = [];

function installPoolTracker(): void {
  class TrackedPool extends RealPool {
    constructor(...args: ConstructorParameters<typeof RealPool>) {
      super(...args);
      trackedPools.push(this);
    }
  }
  (pg as { Pool: typeof pg.Pool }).Pool = TrackedPool as typeof pg.Pool;
}

/** Narrow the optional `transaction` without non-null assertions. */
function requireTransaction(client: DbClient): NonNullable<DbClient["transaction"]> {
  const fn = client.transaction;
  if (!fn) throw new Error("expected a production DbClient with transaction() — got a two-method mock");
  return fn.bind(client);
}

function sqlstate(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code?: unknown }).code) : undefined;
}

// Run-unique ids so a rerun against a non-fresh local database never
// collides with a previous run's rows (topics.title carries a UNIQUE index).
const RUN = `c${Date.now().toString(36)}`;
const topicId = (slug: string): string => `canary-5599-${RUN}-${slug}`;
const CANARY_TOPIC_SLUGS = ["scoped-rollback", "scoped-commit", "pooled-second-tx", "mock-direct"] as const;

describeDb("#5599 B-0 — Source KG real-Postgres canaries", () => {
  let dbmod: typeof DbModule;
  let db: DbClient;

  beforeAll(async () => {
    installPoolTracker();
    // Dynamic import so the pool tracker is installed before db.ts's module
    // init destructures pg.Pool. getDb() is the production entry point and
    // runs initSchema — cold-start bootstrap #1 against the fresh container.
    dbmod = await import("@/lib/db");
    db = await dbmod.getDb();

    // Seed (and COMMIT) the canary topics up front: events.topic_id has a
    // REFERENCES topics(id) FK, and the pooled-client canary appends from a
    // SECOND connection that cannot see this test's uncommitted work.
    for (const slug of CANARY_TOPIC_SLUGS) {
      const id = topicId(slug);
      await db.execute({
        sql: "INSERT INTO topics (id, title, content) VALUES (?, ?, ?)",
        args: [id, id, "canary topic for the #5599 B-0 transaction-semantics pins"],
      });
    }
  });

  afterAll(async () => {
    (pg as { Pool: typeof pg.Pool }).Pool = RealPool;
    await Promise.all(trackedPools.map((p) => p.end().catch(() => undefined)));
  });

  // ── pgify — pre-check (ii), as executable documentation ──────────────────
  // pgify (db.ts) is a TEXTUAL rewriter: every `?` becomes `$n` and every
  // bare camelCase word is double-quoted — including inside SQL string
  // literals. Prod-proven for the statement shapes db.ts issues; the pins
  // below document both the happy path the canaries rely on and the two
  // textual edges canary SQL must avoid.
  describe("pgify placeholder translation (pre-check for the canary SQL surface)", () => {
    it("translates ? placeholders positionally and preserves camelCase aliases by quoting them", async () => {
      const r = await db.execute({
        sql: "SELECT ?::int AS first_value, ? AS secondValue",
        args: [41, "ok"],
      });
      expect(r.rows[0]?.first_value).toBe(41);
      // pgify double-quoted the bare camelCase alias, so Postgres preserved
      // its case instead of folding it to lowercase.
      expect(r.rows[0]?.secondValue).toBe("ok");
      expect(r.rows[0] && "secondvalue" in r.rows[0]).toBe(false);
    });

    it("EDGE (pinned): a literal '?' inside a SQL string is ALSO rewritten to a $n", async () => {
      const r = await db.execute("SELECT '?' AS q");
      expect(r.rows[0]?.q).toBe("$1");
    });

    it("EDGE (pinned): a camelCase word inside a SQL string literal is ALSO double-quoted", async () => {
      const r = await db.execute("SELECT 'aCamelWord' AS q");
      expect(r.rows[0]?.q).toBe('"aCamelWord"');
    });
  });

  // ── Canary (a) — the savepoint bomb ──────────────────────────────────────
  // db.transaction wraps fn in ONE BEGIN/COMMIT with no savepoints. A caller
  // that swallows a statement error (`catch {}`) and carries on poisons the
  // whole transaction: Postgres aborts it at the first error, and every
  // subsequent statement raises 25P02 in_failed_sql_transaction. This is the
  // exact failure class the #5599 work defuses.
  describe("canary (a): db.transaction has no savepoints — a swallowed error aborts the whole transaction", () => {
    it("any statement after a swallowed failure raises 25P02 in_failed_sql_transaction", async () => {
      const inTx = requireTransaction(db);
      await inTx(async (tx) => {
        try {
          await tx.execute("SELECT * FROM table_that_does_not_exist_5599");
        } catch {
          // Deliberately swallowed — the anti-pattern this canary pins.
        }
        let code: string | undefined;
        try {
          await tx.execute("SELECT 1");
        } catch (e) {
          code = sqlstate(e);
        }
        expect(code).toBe("25P02");
      });
    });

    it("COMMIT of an aborted transaction silently ROLLS BACK — the caller sees success while its writes are discarded", async () => {
      const inTx = requireTransaction(db);
      const key = `canary-5599-${RUN}-aborted-commit`;
      // The fn resolves without throwing, runInTransaction issues COMMIT, and
      // Postgres answers with ROLLBACK (no error) because the transaction is
      // aborted — so from the caller's perspective this "succeeds".
      await inTx(async (tx) => {
        await tx.execute({
          sql: "INSERT INTO sweep_state (key, value) VALUES (?, ?)",
          args: [key, "written-before-the-bomb"],
        });
        try {
          await tx.execute("SELECT * FROM table_that_does_not_exist_5599");
        } catch {
          // swallowed
        }
        // No further statements: fn returns "successfully".
      });
      // …but the pre-bomb write is GONE. Silent data loss, pinned.
      const r = await db.execute({
        sql: "SELECT count(*) AS n FROM sweep_state WHERE key = ?",
        args: [key],
      });
      expect(r.rows[0]?.n).toBe(0);
    });
  });

  // ── Canary (b) — nested transaction() flattens, no SAVEPOINT ─────────────
  // createTransactionScopedClient sets tx.transaction = fn => fn(tx): a
  // nested transaction() call participates in the open transaction on the
  // SAME client and issues no SAVEPOINT. Both the direct observable (object
  // identity) and the consequence (an inner failure poisons the outer
  // transaction, with no savepoint to roll back to) are pinned.
  describe("canary (b): createTransactionScopedClient flattens nested transaction() calls", () => {
    it("a nested transaction() hands back the SAME client object (participation, not a savepoint)", async () => {
      const inTx = requireTransaction(db);
      await inTx(async (tx) => {
        expect(tx.inTransaction).toBe(true);
        let inner: DbClient | undefined;
        const nested = requireTransaction(tx);
        await nested(async (i) => {
          inner = i;
        });
        expect(inner).toBe(tx);
      });
    });

    it("consequence: a failure inside the nested transaction() poisons the OUTER transaction (25P02 on the next outer statement)", async () => {
      const inTx = requireTransaction(db);
      await inTx(async (tx) => {
        const nested = requireTransaction(tx);
        try {
          await nested(async (inner) => {
            await inner.execute("SELECT * FROM table_that_does_not_exist_5599");
          });
        } catch {
          // With real savepoints the outer transaction could continue after
          // rolling back the inner scope. Today it cannot — pinned below.
        }
        let code: string | undefined;
        try {
          await tx.execute("SELECT 1");
        } catch (e) {
          code = sqlstate(e);
        }
        expect(code).toBe("25P02");
      });
    });
  });

  // ── Canary (c) — the emitEvent client-type guard (db.ts ~:1224-1229) ─────
  // emitEvent branches on `db.inTransaction || !db.transaction`:
  //   scoped client (inTransaction)   → append directly, riding the caller's tx
  //   mock client (no .transaction)   → append directly, unwrapped
  //   pooled client (has .transaction)→ db.transaction(...) — a SECOND transaction
  describe("canary (c): emitEvent guard behaviour per client type", () => {
    it("scoped-in-transaction client: the chain link rides the caller's transaction — rollback discards it", async () => {
      const topic = topicId("scoped-rollback");
      const inTx = requireTransaction(db);
      await expect(
        inTx(async (tx) => {
          await dbmod.emitEvent(tx, topic, "pact.topic.stable");
          throw new Error("force rollback");
        })
      ).rejects.toThrow("force rollback");
      const r = await db.execute({
        sql: "SELECT count(*) AS n FROM events WHERE topic_id = ?",
        args: [topic],
      });
      expect(r.rows[0]?.n).toBe(0);
    });

    it("scoped-in-transaction client: commits with the caller — seq 1, GENESIS prev_hash, stamped hash", async () => {
      const topic = topicId("scoped-commit");
      const inTx = requireTransaction(db);
      await inTx(async (tx) => {
        await dbmod.emitEvent(tx, topic, "pact.topic.stable");
      });
      const r = await db.execute({
        sql: "SELECT sequence_number, prev_hash, event_hash, hash_alg FROM events WHERE topic_id = ?",
        args: [topic],
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.sequence_number).toBe(1);
      expect(r.rows[0]?.prev_hash).toBe("GENESIS");
      expect(r.rows[0]?.hash_alg).toBe("sha256-jcs@1");
      expect(typeof r.rows[0]?.event_hash).toBe("string");
      expect((r.rows[0]?.event_hash as string).length).toBeGreaterThan(0);
    });

    it("CURRENT #5599 FLAW (pinned): the POOLED client inside a caller's transaction opens a SECOND transaction — the chain link survives the caller's rollback", async () => {
      // #5599 PR-C will flip this to a THROW: passing the pooled client from
      // inside an open transaction must become an error, because the chain
      // link committing independently of the state change it records breaks
      // the §6.4 atomicity emitEvent exists to provide. PR-A rerouted every
      // production route onto transaction-scoped clients (withTransaction),
      // so no production caller takes this branch any more — but the branch
      // itself is unchanged and stays pinned as-is until PR-C lands the
      // interlock.
      const topic = topicId("pooled-second-tx");
      const inTx = requireTransaction(db);
      await expect(
        inTx(async () => {
          await dbmod.emitEvent(db, topic, "pact.topic.stable"); // NOTE: pooled db, not tx
          throw new Error("caller rolls back");
        })
      ).rejects.toThrow("caller rolls back");
      const r = await db.execute({
        sql: "SELECT count(*) AS n FROM events WHERE topic_id = ?",
        args: [topic],
      });
      // The event committed in its own transaction even though the caller's
      // transaction rolled back. When #5599 lands, this assertion flips
      // (expected count 0, plus a rejects.toThrow on the emitEvent itself).
      expect(r.rows[0]?.n).toBe(1);
    });

    it("mock client without .transaction: appends directly (unwrapped) and still chains", async () => {
      const topic = topicId("mock-direct");
      // The two-method mock shape emitEvent's guard exists for — execute
      // delegates to the real pool so the statements hit real Postgres, but
      // there is no .transaction, so emitEvent takes the direct-append path
      // (each statement in its own implicit transaction; the advisory
      // xact-lock acquires and releases per statement).
      const mock: DbClient = {
        execute: (s) => db.execute(s),
        batch: (s) => db.batch(s),
      };
      await dbmod.emitEvent(mock, topic, "pact.topic.stable");
      const r = await db.execute({
        sql: "SELECT sequence_number, prev_hash, hash_alg FROM events WHERE topic_id = ?",
        args: [topic],
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.sequence_number).toBe(1);
      expect(r.rows[0]?.prev_hash).toBe("GENESIS");
      expect(r.rows[0]?.hash_alg).toBe("sha256-jcs@1");
    });
  });

  // ── Canary (d) — initSchema idempotency (MUST run last in this file) ─────
  // getDb() ran initSchema against the fresh service container in beforeAll
  // (bootstrap #1). Re-importing db.ts after vi.resetModules() simulates a
  // second cold start of the app against the SAME database: every CREATE
  // TABLE IF NOT EXISTS / ALTER ... IF NOT EXISTS / idempotent seed must run
  // clean the second time. Declared last so the module-registry reset cannot
  // interfere with the other canaries' captured references.
  describe("canary (d): initSchema self-bootstrap is idempotent against a real database", () => {
    it("a second cold start (fresh module, same database) bootstraps clean", async () => {
      vi.resetModules();
      const fresh: typeof DbModule = await import("@/lib/db");
      const db2 = await fresh.getDb(); // bootstrap #2 — throws if any statement is not idempotent
      const domains = await db2.execute(
        "SELECT count(*) AS n FROM domains WHERE id = 'property_development'"
      );
      expect(domains.rows[0]?.n).toBe(1); // seed stayed single (ON CONFLICT DO NOTHING)
      // The canary topics written by bootstrap-#1's client are still there —
      // the second bootstrap mutated nothing it should not have.
      const topics = await db2.execute({
        sql: "SELECT count(*) AS n FROM topics WHERE id = ?",
        args: [topicId("scoped-commit")],
      });
      expect(topics.rows[0]?.n).toBe(1);
    });
  });
});
