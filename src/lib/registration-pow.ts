// Registration proof-of-work (tailor-group#7).
//
// Open registration used to be protected by a 3/hour-per-IP quota, which
// in the no-Redis production posture clamped to 1/hour — a seed run of 30
// agents took more than a day, and any shared NAT was locked out. The
// quota is replaced by a cheap, stateless cost: the caller must present a
// SHA-256 partial-preimage over a server-signed challenge. Cost per
// identity is ~1 s of CPU for a legitimate client (2^20 hashes at
// difficulty 20) and scales linearly for a spammer, while the server
// spends one HMAC verification and one hash per attempt.
//
// Challenge = base64url(payload) "." base64url(HMAC-SHA256(key, payload))
//   payload = { v: 1, ts: <ms>, bits: <difficulty>, n: <random> }
// Solution  = { challenge, nonce } where
//   sha256(`${challenge}:${nonce}`) has ≥ bits leading zero bits.
//
// Single-use: a solved challenge is remembered until it expires (in
// memory; Redis SET NX when a client is available), so one solution cannot
// be replayed. Stateless issuance means no table, no Azure resource.
//
// Key: REGISTRATION_POW_SECRET, else derived from ADMIN_SECRET, else a
// per-process random key (fine for a single replica; challenges simply die
// with the process). Tunables: REGISTRATION_POW_BITS (default 20),
// REGISTRATION_POW_TTL_SECONDS (default 600). REGISTRATION_POW=off disables
// the gate for local development only — never set it in production.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getRedis } from "./redis-client";

export const POW_ALGORITHM = "sha256-leading-zero-bits" as const;
const DEFAULT_BITS = 20;
const MIN_BITS = 8;
const MAX_BITS = 32;
const DEFAULT_TTL_SECONDS = 600;
const MAX_NONCE_LENGTH = 64;

let _processKey: Buffer | null = null;

function hmacKey(): Buffer {
  const explicit = process.env.REGISTRATION_POW_SECRET;
  if (explicit) return createHash("sha256").update(`pow:${explicit}`).digest();
  const admin = process.env.ADMIN_SECRET;
  if (admin) return createHash("sha256").update(`pow:${admin}`).digest();
  if (!_processKey) _processKey = randomBytes(32);
  return _processKey;
}

export function powEnabled(): boolean {
  return (process.env.REGISTRATION_POW ?? "on").toLowerCase() !== "off";
}

export function powBits(): number {
  const raw = Number(process.env.REGISTRATION_POW_BITS ?? DEFAULT_BITS);
  if (!Number.isFinite(raw)) return DEFAULT_BITS;
  return Math.min(MAX_BITS, Math.max(MIN_BITS, Math.floor(raw)));
}

export function powTtlSeconds(): number {
  const raw = Number(process.env.REGISTRATION_POW_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TTL_SECONDS;
}

interface ChallengePayload {
  v: 1;
  ts: number;
  bits: number;
  n: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string): string {
  return b64url(createHmac("sha256", hmacKey()).update(payloadB64).digest());
}

export interface IssuedChallenge {
  challenge: string;
  algorithm: typeof POW_ALGORITHM;
  bits: number;
  expiresIn: number;
}

/** Mint a fresh signed challenge. Stateless — nothing is stored at issue time. */
export function issueChallenge(now: number = Date.now()): IssuedChallenge {
  const payload: ChallengePayload = { v: 1, ts: now, bits: powBits(), n: b64url(randomBytes(12)) };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return {
    challenge: `${payloadB64}.${sign(payloadB64)}`,
    algorithm: POW_ALGORITHM,
    bits: payload.bits,
    expiresIn: powTtlSeconds(),
  };
}

function parseChallenge(challenge: string, now: number): { ok: true; payload: ChallengePayload } | { ok: false; reason: string } {
  if (typeof challenge !== "string" || challenge.length > 512) return { ok: false, reason: "malformed challenge" };
  const dot = challenge.indexOf(".");
  if (dot <= 0 || dot === challenge.length - 1) return { ok: false, reason: "malformed challenge" };
  const payloadB64 = challenge.slice(0, dot);
  const sig = challenge.slice(dot + 1);
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "challenge signature invalid" };

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ChallengePayload;
  } catch {
    return { ok: false, reason: "malformed challenge" };
  }
  if (payload?.v !== 1 || typeof payload.ts !== "number" || typeof payload.bits !== "number") {
    return { ok: false, reason: "malformed challenge" };
  }
  if (now - payload.ts > powTtlSeconds() * 1000 || payload.ts - now > 60_000) {
    return { ok: false, reason: "challenge expired" };
  }
  return { ok: true, payload };
}

/** Count leading zero bits of a digest. */
export function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function powDigest(challenge: string, nonce: string): Buffer {
  return createHash("sha256").update(`${challenge}:${nonce}`).digest();
}

/** Reference solver (used by tests and documented for clients). */
export function solveChallenge(challenge: string, bits: number): string {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (leadingZeroBits(powDigest(challenge, nonce)) >= bits) return nonce;
  }
}

// ── Single-use ledger ───────────────────────────────────────────────────────

const usedInMemory = new Map<string, number>(); // challenge → expiresAt(ms)

function sweepUsed(now: number) {
  if (usedInMemory.size < 1024) return;
  for (const [k, exp] of usedInMemory) if (exp <= now) usedInMemory.delete(k);
}

async function markUsed(challenge: string, ttlMs: number, now: number): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    try {
      const set = await redis.set(`pow:used:${createHash("sha256").update(challenge).digest("hex")}`, "1", {
        NX: true,
        PX: ttlMs,
      });
      return set === "OK";
    } catch {
      // fall through to memory
    }
  }
  sweepUsed(now);
  const exp = usedInMemory.get(challenge);
  if (exp && exp > now) return false;
  usedInMemory.set(challenge, now + ttlMs);
  return true;
}

export type PowVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Verify a solution and consume the challenge. Order matters: the cheap
 * signature/expiry checks run first, the hash next, and the single-use
 * write last, so a bad solution never burns a valid challenge.
 */
export async function verifySolution(
  solution: unknown,
  now: number = Date.now()
): Promise<PowVerdict> {
  if (!solution || typeof solution !== "object") return { ok: false, reason: "pow object required" };
  const { challenge, nonce } = solution as { challenge?: unknown; nonce?: unknown };
  if (typeof challenge !== "string" || typeof nonce !== "string") return { ok: false, reason: "pow.challenge and pow.nonce must be strings" };
  if (nonce.length === 0 || nonce.length > MAX_NONCE_LENGTH) return { ok: false, reason: `pow.nonce must be 1–${MAX_NONCE_LENGTH} characters` };

  const parsed = parseChallenge(challenge, now);
  if (!parsed.ok) return parsed;

  if (leadingZeroBits(powDigest(challenge, nonce)) < parsed.payload.bits) {
    return { ok: false, reason: `pow.nonce does not meet difficulty ${parsed.payload.bits}` };
  }

  const remainingMs = Math.max(1000, parsed.payload.ts + powTtlSeconds() * 1000 - now);
  const fresh = await markUsed(challenge, remainingMs, now);
  if (!fresh) return { ok: false, reason: "challenge already used" };
  return { ok: true };
}

/** Test seam. */
export function __resetPowForTests(): void {
  usedInMemory.clear();
  _processKey = null;
}
