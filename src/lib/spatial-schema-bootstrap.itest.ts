/**
 * tailor-group#38 (verification finding) — the #874 spatial snapshot tables
 * are part of the schema `initSchema` bootstraps, so a fresh database can run
 * the spatial-snapshot cron. Before this, `sql/874-spatial-snapshot-schema.sql`
 * was "run once" against production only, and every other database failed the
 * job with `relation "spatial_snapshot_layer" does not exist`.
 *
 * Runs ONLY when DATABASE_URL points at a real Postgres (the kg-integration
 * job); without it the canary skips, loudly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { DbClient } from "@/lib/db";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  process.stderr.write(
    "\n[spatial-schema-bootstrap.itest] DATABASE_URL is not set — SKIPPING the spatial schema bootstrap canary (tailor-group#38).\n\n",
  );
}

const describeDb = DATABASE_URL ? describe : describe.skip;

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

describeDb("tailor-group#38 — initSchema bootstraps the #874 spatial snapshot tables", () => {
  let db: DbClient;

  beforeAll(async () => {
    installPoolTracker();
    const dbmod = await import("@/lib/db");
    db = await dbmod.getDb();
  });

  afterAll(async () => {
    (pg as { Pool: typeof pg.Pool }).Pool = RealPool;
    await Promise.all(trackedPools.map((p) => p.end().catch(() => undefined)));
  });

  it.each(["spatial_snapshot_layer", "spatial_feature", "spatial_derived_fact"])(
    "creates %s so the spatial-snapshot cron can record its layers",
    async (table) => {
      const r = await db.execute({ sql: "SELECT to_regclass(?) AS rel", args: [`public.${table}`] });
      expect(r.rows[0]?.rel).toBe(table);
    },
  );

  it("the layer registry accepts the row the cron writes and is idempotent on re-bootstrap", async () => {
    const dbmod = await import("@/lib/db");
    // A second bootstrap must be a no-op (CREATE ... IF NOT EXISTS, COMMENT ON, CREATE INDEX IF NOT EXISTS).
    await expect(dbmod.getDb()).resolves.toBeDefined();
    await db.execute({
      sql: `INSERT INTO spatial_snapshot_layer (layer_name, layer_url, status)
        VALUES (?, ?, 'pending')
        ON CONFLICT (layer_name) DO UPDATE SET layer_url = excluded.layer_url`,
      args: ["itest-tg38-layer", "https://example.invalid/arcgis/layer"],
    });
    const r = await db.execute({
      sql: "SELECT status, feature_count FROM spatial_snapshot_layer WHERE layer_name = ?",
      args: ["itest-tg38-layer"],
    });
    expect(r.rows[0]).toMatchObject({ status: "pending", feature_count: 0 });
    await db.execute({ sql: "DELETE FROM spatial_snapshot_layer WHERE layer_name = ?", args: ["itest-tg38-layer"] });
  });
});
