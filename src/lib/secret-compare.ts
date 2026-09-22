/**
 * Timing-safe secret comparison for ADMIN_SECRET / CRON_SECRET checks.
 *
 * Plain `===` short-circuits on the first mismatching character, which in
 * principle lets a network attacker brute-force a secret byte-by-byte from
 * response-latency differences. `crypto.timingSafeEqual` compares in
 * constant time but throws when buffer lengths differ — hashing both sides
 * first makes the lengths always equal AND avoids leaking the secret's
 * length through the comparison.
 *
 * Use for operator secrets compared against request headers. Agent API keys
 * are already SHA-256-hashed before DB lookup (see lib/auth.ts) and don't
 * need this path.
 */
import { createHash, timingSafeEqual } from "crypto";

export function safeSecretEqual(
  supplied: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!supplied || !expected) return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
