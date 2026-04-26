// Distributed sliding window rate limiter.
//
// Uses Azure Cache for Redis when AZURE_REDIS_HOSTNAME / AZURE_REDIS_PASSWORD
// env vars are present (production); falls back to in-memory for local dev or
// when Redis is unavailable. The per-key sorted-set sliding-window semantics
// are unchanged from the prior @upstash/redis implementation.
//
// Migration: #1310 / MEGA-80 WS0b — see lib/redis-client.ts header.

import { getRedis, type SourceRedisClient } from "./redis-client";

// ── Config ──────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

const DEFAULTS: Record<string, RateLimitConfig> = {
  register: { limit: 3, windowSeconds: 3600 },       // 3 registrations/hour per IP
  read: { limit: 120, windowSeconds: 60 },            // 120 reads/min
  write: { limit: 30, windowSeconds: 60 },            // 30 writes/min
  global: { limit: 200, windowSeconds: 60 },          // 200 total/min per key
  "axiom-keys": { limit: 3, windowSeconds: 3600 },   // 3 key creations/hour per IP
};

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

// ── In-memory fallback (local dev / Redis unavailable) ──────────────────────

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

// ── Public API ──────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";
let _redisWarned = false;

/**
 * Rate-limit a key. Uses Azure Cache for Redis in production, in-memory as
 * fallback for local dev. In production without Redis (env vars missing or
 * connect failure), applies very conservative in-memory limits (10% of normal).
 */
export async function rateLimit(
  key: string,
  configName: keyof typeof DEFAULTS = "global"
): Promise<RateLimitResult> {
  const config = DEFAULTS[configName];
  const fullKey = `${configName}:${key}`;

  const redis = await getRedis();
  if (redis) {
    try {
      return await redisRateLimit(redis, fullKey, config);
    } catch {
      // Redis blip — fall through to in-memory
    }
  }

  if (isProduction && !_redisWarned) {
    _redisWarned = true;
    console.error("[SECURITY] Redis rate limiting unavailable in production. Set AZURE_REDIS_HOSTNAME and AZURE_REDIS_PASSWORD.");
  }

  if (isProduction) {
    const conservativeConfig: RateLimitConfig = {
      limit: Math.max(1, Math.floor(config.limit * 0.1)),
      windowSeconds: config.windowSeconds,
    };
    return memoryRateLimit(fullKey, conservativeConfig);
  }

  return memoryRateLimit(fullKey, config);
}

export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetIn),
  };
}
