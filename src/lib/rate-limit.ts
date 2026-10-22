// Distributed sliding window rate limiter.
//
// Uses Azure Cache for Redis when AZURE_REDIS_HOSTNAME / AZURE_REDIS_PASSWORD
// env vars are present; falls back to in-memory otherwise. The per-key
// sorted-set sliding-window semantics are unchanged from the prior
// @upstash/redis implementation.
//
// Migration: #1310 / MEGA-80 WS0b — see lib/redis-client.ts header.
//
// No-Redis posture (tailor-group#7). The knowledge graph runs on
// pact-web with `--min-replicas 1` and no Redis provisioned, so the
// in-memory path IS production. It used to clamp every limit to 10% of
// design ("very conservative"), which turned 120 reads/min into 12 and the
// registration window into 1/hour — an outage dressed as a safeguard. The
// in-memory limiter is now authoritative at the design limits. Its one
// weakness is that each replica counts alone; with `--max-replicas 3`
// (cd-kg.yml) the worst case under scale-out is 3× the design limit per
// key, which is still abuse control. Set RATE_LIMIT_REPLICA_HINT to the
// expected replica count to divide the in-memory limits back down when
// scale-out is routine. Redis remains the right answer for a multi-replica
// steady state; provisioning it is a Knox decision, not a code default.

import { getRedis, type SourceRedisClient } from "./redis-client";
import { log } from "./logger";

// ── Config ──────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

const DEFAULTS = {
  // Registration is gated by proof-of-work (lib/registration-pow.ts), not by
  // a tight per-IP quota. `register-ip` is a flood backstop only: wide enough
  // that a seed run or a shared NAT never trips it, tight enough that a
  // single origin cannot mint thousands of identities an hour.
  "register-ip": { limit: 60, windowSeconds: 3600 },   // 60 registrations/hour per IP (flood backstop)
  read: { limit: 120, windowSeconds: 60 },             // 120 reads/min
  write: { limit: 30, windowSeconds: 60 },             // 30 writes/min per key
  global: { limit: 200, windowSeconds: 60 },           // 200 total/min per key
  "axiom-keys": { limit: 3, windowSeconds: 3600 },     // 3 key creations/hour per IP
} satisfies Record<string, RateLimitConfig>;

export type RateLimitName = keyof typeof DEFAULTS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

// ── Distributed rate limit (Redis sorted-set sliding window) ────────────────

async function redisRateLimit(
  redis: SourceRedisClient,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStart = now - windowMs;
  const redisKey = `rl:${key}`;

  // node-redis v4 MULTI: same atomic pipeline semantics as the Upstash version,
  // but using the RESP-native command names (camelCase per node-redis convention).
  const multi = redis.multi();
  multi.zRemRangeByScore(redisKey, 0, windowStart);
  multi.zAdd(redisKey, { score: now, value: `${now}:${Math.random().toString(36).slice(2, 8)}` });
  multi.zCard(redisKey);
  multi.expire(redisKey, config.windowSeconds + 10); // TTL slightly longer than window

  const results = await multi.exec();
  // results[2] is the zCard reply (the post-add count).
  const count = (results[2] as number) ?? 0;

  return {
    allowed: count <= config.limit,
    remaining: Math.max(0, config.limit - count),
    resetIn: config.windowSeconds,
  };
}

// ── In-memory limiter (single replica / Redis unavailable) ──────────────────

interface RateWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, RateWindow>();
let lastCleanup = Date.now();

function memoryCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [k, w] of windows) {
    if (w.resetAt < now) windows.delete(k);
  }
}

function memoryRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  memoryCleanup();
  const now = Date.now();
  let w = windows.get(key);

  if (!w || w.resetAt < now) {
    w = { count: 0, resetAt: now + config.windowSeconds * 1000 };
    windows.set(key, w);
  }

  w.count++;

  return {
    allowed: w.count <= config.limit,
    remaining: Math.max(0, config.limit - w.count),
    resetIn: Math.ceil((w.resetAt - now) / 1000),
  };
}

/**
 * Optional divisor for the in-memory path. Each replica counts alone, so an
 * operator running N replicas without Redis can set RATE_LIMIT_REPLICA_HINT=N
 * to keep the fleet-wide ceiling at the design limit. Default 1 (single
 * replica: the in-memory count is exact).
 */
function replicaHint(): number {
  const raw = Number(process.env.RATE_LIMIT_REPLICA_HINT ?? "1");
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function memoryConfigFor(config: RateLimitConfig): RateLimitConfig {
  const hint = replicaHint();
  if (hint <= 1) return config;
  return { limit: Math.max(1, Math.floor(config.limit / hint)), windowSeconds: config.windowSeconds };
}

// ── Public API ──────────────────────────────────────────────────────────────

let _noRedisNoted = false;

/**
 * Rate-limit a key. Uses Azure Cache for Redis when configured; otherwise the
 * in-memory limiter at the DESIGN limits (see header). The one-time log line
 * keeps the posture visible in App Insights without spamming.
 */
export async function rateLimit(
  key: string,
  configName: RateLimitName = "global"
): Promise<RateLimitResult> {
  const config: RateLimitConfig = DEFAULTS[configName];
  const fullKey = `${configName}:${key}`;

  const redis = await getRedis();
  if (redis) {
    try {
      return await redisRateLimit(redis, fullKey, config);
    } catch {
      // Redis blip — fall through to in-memory
    }
  }

  if (!_noRedisNoted && process.env.NODE_ENV === "production") {
    _noRedisNoted = true;
    log.warn(
      { op: "rate_limit.memory", replicaHint: replicaHint() },
      "rate limiting is in-memory (no Redis): design limits apply per replica"
    );
  }

  return memoryRateLimit(fullKey, memoryConfigFor(config));
}

export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetIn),
  };
}

/** Test seam — clears the in-memory windows and the one-time log flag. */
export function __resetRateLimitForTests(): void {
  windows.clear();
  _noRedisNoted = false;
}
