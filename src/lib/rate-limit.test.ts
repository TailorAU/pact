/**
 * tailor-group#7 — the no-Redis path is production on a single replica.
 * It must enforce the DESIGN limits, not a 10% clamp (which turned 120
 * reads/min into 12 and made open registration a 1/hour trickle).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRedis = vi.fn(async () => null);
vi.mock("./redis-client", () => ({
  getRedis: () => getRedis(),
}));

import { rateLimit, __resetRateLimitForTests } from "./rate-limit";

const originalEnv = { ...process.env };

async function drain(key: string, name: Parameters<typeof rateLimit>[1], n: number) {
  let allowed = 0;
  for (let i = 0; i < n; i++) {
    const r = await rateLimit(key, name);
    if (r.allowed) allowed++;
  }
  return allowed;
}

beforeEach(() => {
  __resetRateLimitForTests();
  getRedis.mockReset();
  getRedis.mockResolvedValue(null);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("rateLimit without Redis", () => {
  it("keeps the design read limit (120/min) in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await drain("ip-1", "read", 130)).toBe(120);
    vi.unstubAllEnvs();
  });

  it("keeps the design write limit (30/min per key) in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await drain("agent-1", "write", 40)).toBe(30);
    vi.unstubAllEnvs();
  });

  it("registration flood backstop is 60/hour per IP, not 3 (nor 1)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await drain("203.0.113.9", "register-ip", 70)).toBe(60);
    vi.unstubAllEnvs();
  });

  it("counts keys independently", async () => {
    expect(await drain("a", "write", 30)).toBe(30);
    expect(await drain("b", "write", 30)).toBe(30);
    expect((await rateLimit("a", "write")).allowed).toBe(false);
  });

  it("RATE_LIMIT_REPLICA_HINT divides the in-memory limit for scale-out", async () => {
    process.env.RATE_LIMIT_REPLICA_HINT = "3";
    expect(await drain("agent-2", "write", 30)).toBe(10);
  });

  it("ignores a nonsense replica hint", async () => {
    process.env.RATE_LIMIT_REPLICA_HINT = "zero";
    expect(await drain("agent-3", "write", 31)).toBe(30);
  });

  it("returns reset/remaining headers material", async () => {
    const r = await rateLimit("x", "read");
    expect(r.remaining).toBe(119);
    expect(r.resetIn).toBeGreaterThan(0);
    expect(r.resetIn).toBeLessThanOrEqual(60);
  });
});
