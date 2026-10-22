/**
 * tailor-group#35 / pact#78 — real-Postgres canaries for the lock protocol of
 * the reviewed-document guard in `replaceLegislationDocuments`.
 *
 * The mock suite pins the statement stream; only a real server shows that a
 * guarded (`scheduled` / `admin` / `proposal`) write serialises behind a
 * concurrent reviewed write on the same rows and reads the COMMITTED marker,
 * in both shapes the race takes:
 *   (1) the document exists — the guarded write blocks on the reviewed
 *       transaction's row lock and skips the document once that commits;
 *   (2) the document is new — the guarded INSERT waits on the reviewed
 *       transaction's uncommitted insert, its conditional statements are
 *       no-ops, and the marker read after the batch reports the skip;
 * and, mirrored, (3) a reviewed write blocks behind a guarded write that
 * locked first, then replaces and re-stamps. Before the protocol the guard's
 * pre-select ran on a pooled connection outside the batch's transaction, so
 * a reviewed write landing between the two was overwritten (Cursor Bugbot on
 * pact#78).
 *
 * Runs ONLY when DATABASE_URL points at a real Postgres (the kg-integration
 * job); without it every canary skips, loudly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { DbClient } from "@/lib/db";
import type * as IngestModule from "@/lib/legislation-ingest";
import type { NormalizedLegislationDocument } from "@/lib/legislation-ingest";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  process.stderr.write(
    "\n[legislation-reviewed-guard.itest] DATABASE_URL is not set — SKIPPING the reviewed-guard lock canaries (tailor-group#35).\n" +
      "[legislation-reviewed-guard.itest] They run in CI against the kg-integration job's postgres:16-alpine service container.\n\n",
  );
}

const describeDb = DATABASE_URL ? describe : describe.skip;

/** Ids under one prefix so setup and teardown touch nothing else in the database. */
const PREFIX = "itest-tg35/";
const EXISTING = `${PREFIX}act-2016-025`;
const FRESH = `${PREFIX}act-1994-062`;
const OTHER = `${PREFIX}reg-2017-078`;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** How long a blocked writer is observed before the holder commits. */
const BLOCK_WINDOW_MS = 400;

const RealPool = pg.Pool;
const trackedPools: InstanceType<typeof pg.Pool>[] = [];

/** Same trick as db.itest.ts: db.ts never closes its module-private pool. */
function installPoolTracker(): void {
  class TrackedPool extends RealPool {
    constructor(...args: ConstructorParameters<typeof RealPool>) {
      super(...args);
      trackedPools.push(this);
    }
  }
  (pg as { Pool: typeof pg.Pool }).Pool = TrackedPool as typeof pg.Pool;
}

/** true when `promise` settles within `ms`, false when it is still pending. */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

describeDb("tailor-group#35 — reviewed-document guard lock protocol (real Postgres)", () => {
  let db: DbClient;
  let ingest: typeof IngestModule;
  let pool: pg.Pool;

  function parserDocument(id: string, content: string, title = `${id} (parser)`): NormalizedLegislationDocument {
    return ingest.normalizeLegislationDocuments([
      { id, jurisdiction: "QLD", type: "act", title, sections: [{ sectionId: "s 1", content }] },
    ])[0];
  }

  async function cleanup(): Promise<void> {
    await pool.query("DELETE FROM legislation_sections WHERE doc_id LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM legislation_relations WHERE from_doc_id LIKE $1 OR to_doc_id LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM legislation_docs WHERE id LIKE $1", [`${PREFIX}%`]);
  }

  async function sectionContents(id: string): Promise<string[]> {
    const r = await pool.query("SELECT content FROM legislation_sections WHERE doc_id = $1 ORDER BY sort_order, id", [id]);
    return r.rows.map((row: { content: string }) => row.content);
  }

  async function docRow(id: string): Promise<{ title: string; reviewed_at: Date | string | null; review_hash: string | null } | undefined> {
    const r = await pool.query("SELECT title, reviewed_at, review_hash FROM legislation_docs WHERE id = $1", [id]);
    return r.rows[0];
  }

  beforeAll(async () => {
    installPoolTracker();
    const dbmod = await import("@/lib/db");
    db = await dbmod.getDb(); // bootstraps the schema, including the reviewed augment
    ingest = await import("@/lib/legislation-ingest");
    pool = new RealPool({ connectionString: DATABASE_URL, max: 2 });
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
    (pg as { Pool: typeof pg.Pool }).Pool = RealPool;
    await Promise.all(trackedPools.map((p) => p.end().catch(() => undefined)));
  });

  it("(1) existing document: a scheduled write blocks on the reviewed transaction's row lock, then skips it and leaves the reviewed sections", async () => {
    await ingest.replaceLegislationDocuments(db, [parserDocument(EXISTING, "parser v1")], { source: "scheduled" });
    expect(await sectionContents(EXISTING)).toEqual(["parser v1"]);

    const holder = await pool.connect();
    try {
      // A reviewed write in flight: it holds the row (its own lock read) and has not stamped yet.
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM legislation_docs WHERE id = $1 FOR UPDATE", [EXISTING]);

      const guarded = ingest.replaceLegislationDocuments(db, [parserDocument(EXISTING, "parser v2")], { source: "scheduled" });
      // Blocked on the lock — not reading an unmarked snapshot and carrying on.
      expect(await settledWithin(guarded, BLOCK_WINDOW_MS)).toBe(false);

      await holder.query("UPDATE legislation_docs SET reviewed_at = NOW(), review_hash = $2 WHERE id = $1", [EXISTING, HASH_A]);
      await holder.query("DELETE FROM legislation_sections WHERE doc_id = $1", [EXISTING]);
      await holder.query(
        "INSERT INTO legislation_sections (id, doc_id, section_id, content) VALUES ($1, $2, 's 1', 'reviewed text')",
        [`${EXISTING}/s 1`, EXISTING],
      );
      await holder.query("COMMIT");

      const result = await guarded;
      expect(result.ingested).toBe(0);
      expect(result.skipped.map((s) => s.id)).toEqual([EXISTING]);
      expect(await sectionContents(EXISTING)).toEqual(["reviewed text"]);
      expect((await docRow(EXISTING))?.review_hash).toBe(HASH_A);
    } finally {
      holder.release();
    }
  });

  it("(2) new document: a scheduled INSERT waits on the reviewed transaction's uncommitted insert, then leaves the marked row, its metadata and its sections alone", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "INSERT INTO legislation_docs (id, jurisdiction, doc_type, title, reviewed_at, review_hash) VALUES ($1, 'QLD', 'act', 'Reviewed title', NOW(), $2)",
        [FRESH, HASH_B],
      );
      await holder.query(
        "INSERT INTO legislation_sections (id, doc_id, section_id, content) VALUES ($1, $2, 's 1', 'reviewed text')",
        [`${FRESH}/s 1`, FRESH],
      );

      // Nothing existed to lock for FRESH when this write started; its INSERT waits on the uncommitted row.
      const guarded = ingest.replaceLegislationDocuments(
        db,
        [parserDocument(FRESH, "parser output", "Parser title"), parserDocument(OTHER, "other parser output")],
        { source: "scheduled" },
      );
      expect(await settledWithin(guarded, BLOCK_WINDOW_MS)).toBe(false);

      await holder.query("COMMIT");

      const result = await guarded;
      expect(result.skipped.map((s) => s.id)).toEqual([FRESH]);
      expect(result.ingested).toBe(1);
      expect(result.documents.map((d) => d.id)).toEqual([OTHER]);
      // The conditional upsert did not touch the metadata; the conditional section statements did not run.
      expect(await docRow(FRESH)).toMatchObject({ title: "Reviewed title", review_hash: HASH_B });
      expect(await sectionContents(FRESH)).toEqual(["reviewed text"]);
      expect(await sectionContents(OTHER)).toEqual(["other parser output"]);
    } finally {
      holder.release();
    }
  });

  it("(3) mirrored: a reviewed write blocks behind a guarded write that locked first, then replaces the sections and stamps the marker", async () => {
    const holder = await pool.connect();
    try {
      // A scheduled write in flight: it holds the row and is about to replace the sections with parser output.
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM legislation_docs WHERE id = $1 FOR UPDATE", [OTHER]);

      const reviewed = ingest.replaceLegislationDocuments(
        db,
        [parserDocument(OTHER, "reviewed text v2", "Reviewed title v2")],
        { source: "reviewed" },
      );
      expect(await settledWithin(reviewed, BLOCK_WINDOW_MS)).toBe(false);

      await holder.query("DELETE FROM legislation_sections WHERE doc_id = $1", [OTHER]);
      await holder.query(
        "INSERT INTO legislation_sections (id, doc_id, section_id, content) VALUES ($1, $2, 's 1', 'parser output v2')",
        [`${OTHER}/s 1`, OTHER],
      );
      await holder.query("COMMIT");

      const result = await reviewed;
      expect(result.ingested).toBe(1);
      expect(result.skipped).toEqual([]);
      expect(await sectionContents(OTHER)).toEqual(["reviewed text v2"]);
      const row = await docRow(OTHER);
      expect(row?.title).toBe("Reviewed title v2");
      // db.ts installs a text type parser for timestamps; the stamp is a parseable instant either way.
      expect(row?.reviewed_at).not.toBeNull();
      expect(new Date(String(row?.reviewed_at)).getTime()).not.toBeNaN();
      expect(row?.review_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      holder.release();
    }
  });
});
