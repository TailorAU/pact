// Distributed sliding window rate limiter
// Uses Upstash Redis when available (production), falls back to in-memory (local dev).

import { Redis } from "@upstash/redis";

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

// ── Redis client (lazy singleton) ───────────────────────────────────────────

let _redis: Redis | null = null;
let _redisFailed = false;

function getRedis(): Redis | null {
  if (_redisFailed) return null;
  if (_redis) return _redis;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    _redisFailed = true;
    return null;
  }
}

// ── Distributed rate limit (Redis sorted-set sliding window) ────────────────

async function redisRateLimit(
  redis: Redis,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStart = now - windowMs;
  const redisKey = `rl:${key}`;

  // Use a pipeline: remove expired, add current, count, set expiry
  const pipe = redis.pipeline();
  pipe.zremrangebyscore(redisKey, 0, windowStart);
  pipe.zadd(redisKey, { score: now, member: `${now}:${Math.random().toString(36).slice(2, 8)}` });
  pipe.zcard(redisKey);
  pipe.expire(redisKey, config.windowSeconds + 10); // TTL slightly longer than window

  const results = await pipe.exec();
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
 * Rate-limit a key. Uses Redis in production, in-memory as fallback for local dev.
 * In production without Redis, applies very conservative in-memory limits (10% of normal).
 */
export async function rateLimit(
  key: string,
  configName: keyof typeof DEFAULTS = "global"
): Promise<RateLimitResult> {
  const config = DEFAULTS[configName];
  const fullKey = `${configName}:${key}`;

  const redis = getRedis();
  if (redis) {
    try {
      return await redisRateLimit(redis, fullKey, config);
    } catch {
      // Redis blip — fall through to in-memory
    }
  }

  if (isProduction && !_redisWarned) {
    _redisWarned = true;
    console.error("[SECURITY] Redis rate limiting unavailable in production. Set KV_REST_API_URL and KV_REST_API_TOKEN.");
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
