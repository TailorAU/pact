/**
 * tailor-group#38 — pin the pool's TCP keepalive.
 *
 * A detached cron job holds its advisory lock on one dedicated pooled
 * connection that is idle for the whole run (minutes for GTFS, fiscal and
 * spatial). pg defaults to `keepAlive: false`, so without this an
 * intermediate NAT/LB can drop the socket silently: Postgres keeps the
 * lock granted, `/status` reports `running: true` for a finished run, and
 * the workflow poller fails at its deadline. These tests assert the
 * options `getPool` spreads into `new Pool(...)` and, at pg's own seam,
 * that pg turns them into libpq's `keepalives=1` / `keepalives_idle=30`,
 * which is what reaches the socket (`stream.setKeepAlive(true, 30000)`).
 */
import { describe, expect, it } from "vitest";
import ConnectionParameters from "pg/lib/connection-parameters";
import { PG_POOL_OPTIONS } from "@/lib/db";

describe("tailor-group#38 — pooled connections keep the idle locked socket alive", () => {
  it("enables keepalive with a 30 s initial delay", () => {
    expect(PG_POOL_OPTIONS).toEqual({ keepAlive: true, keepAliveInitialDelayMillis: 30_000 });
  });

  it("is a delay short enough to beat a four-minute idle timeout", () => {
    expect(PG_POOL_OPTIONS.keepAliveInitialDelayMillis).toBeLessThan(4 * 60_000);
  });

  it("pg maps the options to libpq keepalives=1, keepalives_idle=30", () => {
    // @types/pg's ConnectionParametersConfig omits the keepAlive keys the
    // runtime reads (pg/lib/connection-parameters.js), hence the cast in.
    const config = {
      host: "db.example.invalid",
      database: "pact",
      ...PG_POOL_OPTIONS,
    } as ConstructorParameters<typeof ConnectionParameters>[0];
    const params = new ConnectionParameters(config);
    expect(params.keepalives).toBe(1);
    expect(params.keepalives_idle).toBe(30);
  });
});
