import { describe, it, expect } from "vitest";
import {
  readBodyBounded,
  DEFAULT_MAX_BODY_BYTES,
  ADMIN_INGEST_MAX_BODY_BYTES,
} from "./read-body-bounded";

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("readBodyBounded (#2889 L1)", () => {
  it("passes a normal payload through verbatim", async () => {
    const r = await readBodyBounded(jsonRequest('{"a":1}'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.text)).toEqual({ a: 1 });
  });

  it("rejects an oversize streamed body with 413 even without Content-Length games", async () => {
    const big = '{"pad":"' + "x".repeat(DEFAULT_MAX_BODY_BYTES + 1024) + '"}';
    const r = await readBodyBounded(jsonRequest(big));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(413);
      const body = await r.response.json();
      expect(body.error).toBe("payload_too_large");
      expect(body.maxBytes).toBe(DEFAULT_MAX_BODY_BYTES);
    }
  });

  it("fast-rejects on a declared oversize Content-Length", async () => {
    const r = await readBodyBounded(
      jsonRequest('{"a":1}', { "content-length": String(DEFAULT_MAX_BODY_BYTES + 1) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
  });

  it("admin ingest cap admits multi-MB payloads the default cap would reject", async () => {
    const fiveMb = '{"pad":"' + "x".repeat(5 * 1024 * 1024) + '"}';
    const rejected = await readBodyBounded(jsonRequest(fiveMb));
    expect(rejected.ok).toBe(false);
    const admitted = await readBodyBounded(jsonRequest(fiveMb), ADMIN_INGEST_MAX_BODY_BYTES);
    expect(admitted.ok).toBe(true);
  });

  it("counts bytes, not characters (multi-byte UTF-8 cannot sneak past the cap)", async () => {
    // Each '€' is 3 bytes in UTF-8; char count alone would pass the cap.
    const chars = Math.floor(DEFAULT_MAX_BODY_BYTES / 2);
    const sneaky = "€".repeat(chars);
    const r = await readBodyBounded(jsonRequest(sneaky));
    expect(r.ok).toBe(false);
  });

  it("treats an empty body as ok with empty text (caller's JSON.parse handles it)", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST" });
    const r = await readBodyBounded(req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("");
  });
});
