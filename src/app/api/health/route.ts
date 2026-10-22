// Health probe for Source.
//
// Returns 200 when the app + critical dependencies (DB, Redis) are reachable.
// Returns 503 when any check fails so ACA's readiness probe (and any external
// monitor) can detect degradation and route traffic away.
//
// Contract:
//   GET /api/health
//   200 → { status: "ok", checks: { db, redis }, version, region, latencyMs }
//   503 → { status: "degraded", checks: { ... }, errors: [...], ... }
//
// Cheap to call: no auth, no bodied params. Cap each probe at PROBE_TIMEOUT_MS
// so a slow Postgres (cold start) or hung Redis can't block the readiness loop.
//
// Migration: #1310 / MEGA-80 WS0b — Redis probe now talks to Azure Cache for
// Redis (`australiaeast`) via node-redis v4. Sub-100ms latency expected when
// the cache is in-region; ~600ms cross-region with the legacy Upstash
// posture indicated the substrate gap.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRedis } from "@/lib/redis-client";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 2000;

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} probe timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function probeDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const db = await getDb();
    await withTimeout(db.execute({ sql: "SELECT 1 AS ok", args: [] }), PROBE_TIMEOUT_MS, "db");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    // Generic detail to anonymous callers — raw driver messages can leak
    // internal hostnames/ports (#2881). Full error goes to the server log.
    log.error({ op: "health.probe.db", err: err instanceof Error ? err.message : String(err) }, "db health probe failed");
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: "probe failed",
    };
  }
}

async function probeRedis(): Promise<CheckResult> {
  const start = Date.now();

  // No Redis configured → not a hard failure, but flag it so ops can see.
  // Source has an in-memory rate-limit fallback (see lib/rate-limit.ts), so
  // the app degrades gracefully rather than failing.
  if (!process.env.AZURE_REDIS_HOSTNAME || !process.env.AZURE_REDIS_PASSWORD) {
    return { ok: true, latencyMs: 0, detail: "fallback-in-memory" };
  }

  try {
    const redis = await withTimeout(getRedis(), PROBE_TIMEOUT_MS, "redis-connect");
    if (!redis) {
      return { ok: true, latencyMs: Date.now() - start, detail: "fallback-in-memory" };
    }
    const probeKey = `health:probe:${process.pid}`;
    await withTimeout(
      redis.set(probeKey, "1", { EX: 5 }),
      PROBE_TIMEOUT_MS,
      "redis"
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    // Generic detail to anonymous callers — raw driver messages can leak
    // internal hostnames/ports (#2881). Full error goes to the server log.
    log.error({ op: "health.probe.redis", err: err instanceof Error ? err.message : String(err) }, "redis health probe failed");
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: "probe failed",
    };
  }
}

export async function GET() {
  const overallStart = Date.now();
  const [db, redis] = await Promise.all([probeDb(), probeRedis()]);

  const allOk = db.ok && redis.ok;
  const status = allOk ? "ok" : "degraded";
  const httpStatus = allOk ? 200 : 503;

  const body = {
    status,
    checks: { db, redis },
    version:
      process.env.SOURCE_VERSION ?? process.env.GITHUB_SHA?.slice(0, 7) ?? "dev",
    region: process.env.AZURE_REGION ?? process.env.VERCEL_REGION ?? "unknown",
    latencyMs: Date.now() - overallStart,
    ...(allOk
      ? {}
      : {
          errors: [
            ...(db.ok ? [] : [`db: ${db.detail}`]),
            ...(redis.ok ? [] : [`redis: ${redis.detail}`]),
          ],
        }),
  };

  // Log degraded states so they surface in App Insights / ACA logs even if
  // the probe caller (ACA / external monitor) doesn't capture the body.
  if (!allOk) {
    log.warn({ op: "health.check", status, checks: body.checks }, "health check degraded");
  }

  return NextResponse.json(body, { status: httpStatus });
}
