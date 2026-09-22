import { afterEach, describe, expect, it, vi } from "vitest";

import { dynamic, GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/auth-check", {
    headers: authorization ? { authorization } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/auth-check", () => {
  it("is force-dynamic and fails closed when CRON_SECRET is unavailable", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request() as never);

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET not configured",
    });
  });

  it.each([undefined, "", "Bearer wrong", "bearer cron-test-secret"])(
    "rejects a missing or mismatched bearer value (%s)",
    async (authorization) => {
      vi.stubEnv("CRON_SECRET", "cron-test-secret");

      const response = await GET(request(authorization) as never);

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    },
  );

  it("returns only the safe status envelope for an exact bearer match", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");

    const response = await GET(request("Bearer cron-test-secret") as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
