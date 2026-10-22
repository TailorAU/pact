import { describe, expect, it } from "vitest";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../next.config";

const NO_STORE_CACHE = "no-store, max-age=0, must-revalidate";

async function configuredResponse(path: string) {
  return unstable_getResponseFromNextConfig({
    url: new URL(path, "https://source.tailor.au").toString(),
    nextConfig,
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe(NO_STORE_CACHE);
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
}

describe("next.config API cache policy", () => {
  it.each([
    [
      "canonical exact-state read",
      "/api/axiom/legislation?id=qld%2Freg-2017-165&format=canonical&cb=production-shape",
    ],
    ["admin route", "/api/admin/audit"],
    ["agent audit route", "/api/audit/me"],
    ["work route", "/api/work/assignments"],
    ["PACT route", "/api/pact/topics"],
    ["usage route", "/api/axiom/usage"],
    ["cron route", "/api/cron/legislation-sync?auth_check=1"],
    ["ordinary public legislation list", "/api/axiom/legislation?jurisdiction=QLD&format=json"],
    ["public health route", "/api/health"],
  ])("keeps the %s uncached", async (_case, path) => {
    expectNoStore(await configuredResponse(path));
  });

  it("does not attach the API cache policy to a page route", async () => {
    const response = await configuredResponse("/");

    expect(response.headers.has("cache-control")).toBe(false);
    expect(response.headers.has("cdn-cache-control")).toBe(false);
    expect(response.headers.has("cloudflare-cdn-cache-control")).toBe(false);
  });
});
