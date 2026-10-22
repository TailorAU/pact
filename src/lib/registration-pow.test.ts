/**
 * tailor-group#7 — registration proof-of-work: issue, solve, verify,
 * single-use, expiry, tamper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./redis-client", () => ({
  getRedis: async () => null,
}));

import {
  issueChallenge,
  solveChallenge,
  verifySolution,
  leadingZeroBits,
  powBits,
  powEnabled,
  __resetPowForTests,
} from "./registration-pow";

const originalEnv = { ...process.env };

beforeEach(() => {
  __resetPowForTests();
  process.env.REGISTRATION_POW_BITS = "10"; // fast for tests; production default is 20
  process.env.REGISTRATION_POW_SECRET = "test-secret";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("leadingZeroBits", () => {
  it("counts across bytes", () => {
    expect(leadingZeroBits(Buffer.from([0x00, 0x00, 0x10]))).toBe(19);
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Buffer.from([0x01]))).toBe(7);
  });
});

describe("issue / verify", () => {
  it("issues a challenge at the configured difficulty", () => {
    const c = issueChallenge();
    expect(c.bits).toBe(10);
    expect(c.algorithm).toBe("sha256-leading-zero-bits");
    expect(c.challenge.split(".")).toHaveLength(2);
  });

  it("accepts a correct solution exactly once", async () => {
    const c = issueChallenge();
    const nonce = solveChallenge(c.challenge, c.bits);
    expect(await verifySolution({ challenge: c.challenge, nonce })).toEqual({ ok: true });
    const replay = await verifySolution({ challenge: c.challenge, nonce });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toMatch(/already used/);
  });

  it("rejects a nonce below difficulty without burning the challenge", async () => {
    const c = issueChallenge();
    const good = solveChallenge(c.challenge, c.bits);
    // find a nonce that does NOT satisfy the difficulty
    let bad = "z";
    while (bad === good) bad += "z";
    const r1 = await verifySolution({ challenge: c.challenge, nonce: bad });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toMatch(/difficulty/);
    // the challenge is still usable with the right nonce
    expect(await verifySolution({ challenge: c.challenge, nonce: good })).toEqual({ ok: true });
  });

  it("rejects a tampered challenge (signature)", async () => {
    const c = issueChallenge();
    const [payload, sig] = c.challenge.split(".");
    const tampered = `${payload}.${sig.slice(0, -2)}AA`;
    const r = await verifySolution({ challenge: tampered, nonce: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/signature/);
  });

  it("rejects a challenge whose difficulty was lowered in the payload", async () => {
    const c = issueChallenge();
    const payload = JSON.parse(Buffer.from(c.challenge.split(".")[0], "base64url").toString("utf8"));
    payload.bits = 1;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${c.challenge.split(".")[1]}`;
    const r = await verifySolution({ challenge: forged, nonce: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/signature/);
  });

  it("rejects an expired challenge", async () => {
    const issuedAt = Date.now() - 20 * 60 * 1000;
    const c = issueChallenge(issuedAt);
    const nonce = solveChallenge(c.challenge, c.bits);
    const r = await verifySolution({ challenge: c.challenge, nonce });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it("rejects a challenge signed under a different key", async () => {
    const c = issueChallenge();
    const nonce = solveChallenge(c.challenge, c.bits);
    process.env.REGISTRATION_POW_SECRET = "rotated";
    const r = await verifySolution({ challenge: c.challenge, nonce });
    expect(r.ok).toBe(false);
  });

  it("rejects malformed input shapes", async () => {
    expect((await verifySolution(null)).ok).toBe(false);
    expect((await verifySolution("x")).ok).toBe(false);
    expect((await verifySolution({ challenge: 1, nonce: "a" })).ok).toBe(false);
    expect((await verifySolution({ challenge: "nodot", nonce: "a" })).ok).toBe(false);
    expect((await verifySolution({ challenge: "a.b", nonce: "" })).ok).toBe(false);
    expect((await verifySolution({ challenge: "a.b", nonce: "n".repeat(65) })).ok).toBe(false);
  });
});

describe("configuration", () => {
  it("defaults to 20 bits and clamps the range", () => {
    delete process.env.REGISTRATION_POW_BITS;
    expect(powBits()).toBe(20);
    process.env.REGISTRATION_POW_BITS = "99";
    expect(powBits()).toBe(32);
    process.env.REGISTRATION_POW_BITS = "1";
    expect(powBits()).toBe(8);
    process.env.REGISTRATION_POW_BITS = "abc";
    expect(powBits()).toBe(20);
  });

  it("is on unless explicitly off", () => {
    delete process.env.REGISTRATION_POW;
    expect(powEnabled()).toBe(true);
    process.env.REGISTRATION_POW = "off";
    expect(powEnabled()).toBe(false);
    process.env.REGISTRATION_POW = "OFF";
    expect(powEnabled()).toBe(false);
  });
});
