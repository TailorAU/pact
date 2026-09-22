/**
 * tailor-group#63 — POST /api/pact/axioms/keys is retired.
 *
 * It minted a `pact_ax_` key with a caller-chosen credit balance (up to
 * 1,000,000), unauthenticated and unthrottled. A caller audit found no user
 * of it, so it now answers 410 Gone, reads nothing and writes nothing. The
 * rate-limited free tier at POST /api/axiom/keys is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getDbSpy = vi.fn(async () => {
  throw new Error("the retired route must not touch the database");
});
vi.mock("@/lib/db", () => ({ getDb: () => getDbSpy() }));

import * as route from "./route";

function post(body: unknown) {
  return (route.POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest("http://localhost/api/pact/axioms/keys", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  getDbSpy.mockClear();
});

describe("POST /api/pact/axioms/keys — retired", () => {
  it("an unauthenticated caller asking for 1,000,000 credits gets 410 and no key", async () => {
    const res = await post({ ownerName: "attacker", credits: 1_000_000 });
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json).not.toHaveProperty("secret");
    expect(json).not.toHaveProperty("creditBalance");
    expect(JSON.stringify(json)).not.toContain("pact_ax_");
    expect(json.replacement.url).toBe("/api/axiom/keys");
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("refuses every caller the same way: default credits, repeated calls, no body", async () => {
    for (const body of [{ ownerName: "someone" }, { ownerName: "someone", credits: 5 }, {}]) {
      const res = await post(body);
      expect(res.status).toBe(410);
    }
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("exports no handler other than POST (no GET/PUT mint path left behind)", () => {
    expect(Object.keys(route).filter((k) => /^(GET|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
});
