// Read-through cache for hot Source reads.
//
// Uses the same Upstash Redis singleton pattern as src/lib/rate-limit.ts.
// When Redis is unavailable (env vars absent or transient failure), the
// helper degrades to "always miss" — every call re-fetches from the
// underlying source. The app stays correct; only the cache benefit goes
// away. This matches rate-limit's degradation philosophy.
//
// Usage:
//   const stats = await cache.getOrSet("hub:stats:v1", 30, () => fetchStats());
//
// The cached value is JSON-serialized; the helper handles encode/decode.
//
// Cache invalidation: TTL-based only. We do NOT support explicit invalidation
// here — for that, callers should bump the version suffix in the key
// ("hub:stats:v1" → "hub:stats:v2") which is also how schema-shape changes
// are forced through. Mutation routes that need write-through invalidation
// should use cache.del() (best-effort, never throws).
//
// Performance + SLA targets, CDN strategy, load-test plan: see
// sites/source/docs/PERFORMANCE.md.

import { Redis } from "@upstash/redis";
import { log } from "./logger";

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
  } catch (err) {
    log.warn({ err, op: "cache.redis.init.failed" }, "cache redis init failed; falling back to no-op");
    _redisFailed = true;
    return null;
  }
}

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
  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get<string>(fullKey);
      if (cached) {
        // Upstash returns the value as already-deserialized JSON when stored
        // via .set with a stringified payload. Both string and object shapes
        // can occur depending on driver version — handle both.
        if (typeof cached === "string") {
          try {
            return JSON.parse(cached) as T;
          } catch {
            // Cached as a plain string, return as-is via cast.
            return cached as unknown as T;
          }
        }
        return cached as unknown as T;
      }
    } catch (err) {
      log.warn({ err, key, op: "cache.get.failed" }, "cache get failed; falling through");
    }
  }

  const fresh = await fetchFn();

  if (redis) {
    try {
      await redis.set(fullKey, JSON.stringify(fresh), { ex: ttlSeconds });
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
  const redis = getRedis();
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
