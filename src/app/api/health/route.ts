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
// so a slow Neon (cold start) or hung Redis can't block the readiness loop.

import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getDb } from "@/lib/db";
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
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeRedis(): Promise<CheckResult> {
  const start = Date.now();
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  // No Redis configured → not a hard failure, but flag it so ops can see.
  // Source has an in-memory rate-limit fallback (see lib/rate-limit.ts), so
  // the app degrades gracefully rather than failing.
  if (!url || !token) {
    return { ok: true, latencyMs: 0, detail: "fallback-in-memory" };
  }

  try {
    const redis = new Redis({ url, token });
    const probeKey = `health:probe:${process.pid}`;
    await withTimeout(redis.set(probeKey, "1", { ex: 5 }), PROBE_TIMEOUT_MS, "redis");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
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
