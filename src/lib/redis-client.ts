// Azure Cache for Redis client — shared async singleton.
//
// Uses node-redis v4 (RESP over TLS). Connects lazily on first use; subsequent
// callers reuse the same client instance. Connection failures degrade silently
// to "no client available" — callers (rate-limit, cache, health probe) all
// have graceful fallbacks for that case (in-memory rate-limit, direct fetch
// for cache, fallback-in-memory detail for health).
//
// Migration history (#1310 / MEGA-80 WS0b):
//   Source originally used @upstash/redis (HTTPS REST) which doesn't speak
//   Redis RESP and can't connect to Azure Cache for Redis. This module replaces
//   that integration with node-redis v4 talking RESP-over-TLS to Azure Cache
//   for Redis in `australiaeast`. Sovereignty: data plane fully in `australiaeast`.

import { createClient } from "redis";
import { log } from "./logger";

// Type alias for the createClient return — node-redis v4 has a complex generic
// return type; this captures it without forcing callers to deal with the modules
// generics.
export type SourceRedisClient = ReturnType<typeof createClient>;

let _client: SourceRedisClient | null = null;
let _failed = false;
let _connectInFlight: Promise<SourceRedisClient | null> | null = null;

/**
 * Get the shared Redis client singleton. Returns null when:
 *   - AZURE_REDIS_HOSTNAME or AZURE_REDIS_PASSWORD env vars are absent (local
 *     dev or pre-provisioning state) — caller falls back to non-Redis path.
 *   - The initial connect failed for non-recoverable reasons (auth, DNS, etc.) —
 *     subsequent calls also return null until process restart.
 *
 * Race-safe: if two concurrent callers hit this before the first connect
 * resolves, both await the same in-flight promise.
 */
export async function getRedis(): Promise<SourceRedisClient | null> {
  if (_failed) return null;
  if (_client && _client.isReady) return _client;
  if (_connectInFlight) return _connectInFlight;

  const host = process.env.AZURE_REDIS_HOSTNAME;
  const password = process.env.AZURE_REDIS_PASSWORD;
  if (!host || !password) return null;

  _connectInFlight = (async () => {
    try {
      const client = createClient({
        // SSL on port 6380 is the Azure Cache for Redis default + required posture.
        url: `rediss://:${encodeURIComponent(password)}@${host}:6380`,
        socket: {
          tls: true,
          connectTimeout: 5000,
          // Reconnect with exponential backoff capped at 5s. Production bursts
          // shouldn't trigger this — Azure Redis is reliable — but the safety
          // net is cheap.
          reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
        },
      });

      // Swallow the 'error' event so transient network blips don't bubble as
      // unhandled promise rejections. The client auto-reconnects per the
      // strategy above; commands during the reconnect window throw and the
      // caller's try/catch handles fallback.
      client.on("error", (err) => {
        log.warn({ err, op: "redis.client.error" }, "redis client error event");
      });

      await client.connect();
      _client = client;
      return client;
    } catch (err) {
      log.error({ err, op: "redis.client.connect.failed" }, "redis client connect failed; degrading to no-redis fallback");
      _failed = true;
      return null;
    } finally {
      _connectInFlight = null;
    }
  })();

  return _connectInFlight;
}

/**
 * For tests — reset the singleton + failure flag. Production code should never
 * call this. Exported so tests can simulate fresh-process behaviour without
 * spawning new node processes.
 */
export function __resetRedisClientForTests(): void {
  _client = null;
  _failed = false;
  _connectInFlight = null;
}
