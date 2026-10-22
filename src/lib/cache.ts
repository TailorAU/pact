// Read-through cache for hot Source reads.
//
// Uses the shared Azure Cache for Redis client (lib/redis-client.ts). When
// Redis is unavailable (env vars absent or transient failure), the helper
// degrades to "always miss" — every call re-fetches from the underlying
// source. The app stays correct; only the cache benefit goes away.
//
// Usage:
//   const stats = await cache.getOrSet("hub:stats:v1", 30, () => fetchStats());
//
// The cached value is JSON-serialised; the helper handles encode/decode.
//
// Cache invalidation: TTL-based only. We do NOT support explicit invalidation
// here — for that, callers should bump the version suffix in the key
// ("hub:stats:v1" → "hub:stats:v2") which is also how schema-shape changes
// are forced through. Mutation routes that need write-through invalidation
// should use cache.del() (best-effort, never throws).
//
// Migration: #1310 / MEGA-80 WS0b — moved from @upstash/redis (HTTPS REST) to
// node-redis v4 (RESP+TLS) against Azure Cache for Redis in `australiaeast`.
// Performance + SLA targets, CDN strategy, load-test plan: see
// sites/source/docs/PERFORMANCE.md.

import { getRedis } from "./redis-client";
import { log } from "./logger";

const KEY_PREFIX = "src:cache:";

/**
 * Read-through cache. Returns the cached value if present, otherwise calls
 * `fetchFn`, stores the result, and returns it. The fetcher result must be
 * JSON-serialisable.
 *
 * On Redis failures (transient or unavailable), falls through to fetchFn —
 * the cache layer never breaks the underlying operation.
 */
export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const fullKey = KEY_PREFIX + key;
  const redis = await getRedis();

  if (redis) {
    try {
      const cached = await redis.get(fullKey);
      if (cached !== null) {
        try {
          return JSON.parse(cached) as T;
        } catch {
          // Cached as a non-JSON string — return as-is via cast (defensive;
          // shouldn't happen because we always JSON.stringify on set).
          return cached as unknown as T;
        }
      }
    } catch (err) {
      log.warn({ err, key, op: "cache.get.failed" }, "cache get failed; falling through");
    }
  }

  const fresh = await fetchFn();

  if (redis) {
    try {
      await redis.set(fullKey, JSON.stringify(fresh), { EX: ttlSeconds });
    } catch (err) {
      log.warn({ err, key, op: "cache.set.failed" }, "cache set failed; not blocking response");
    }
  }

  return fresh;
}

/**
 * Best-effort cache delete. Used by mutation routes that need to invalidate
 * a known key after a write. Never throws.
 */
export async function del(key: string): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.del(fullKey);
  } catch (err) {
    log.warn({ err, key, op: "cache.del.failed" }, "cache del failed");
  }
}

/**
 * Stable cache key from search params. Sorts keys for determinism so
 * `?a=1&b=2` and `?b=2&a=1` produce the same key.
 */
export function paramsKey(prefix: string, params: Record<string, string | number | null | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return entries ? `${prefix}:${entries}` : prefix;
}

export const cache = { getOrSet, del, paramsKey };
