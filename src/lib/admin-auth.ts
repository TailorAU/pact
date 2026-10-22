/**
 * #1160 Round 6.4 — Shared admin-key middleware.
 *
 * Admin endpoints authenticate via the `X-Admin-Key` header matched against
 * the `ADMIN_SECRET` env var. Same pattern already in use by
 * `/api/axiom/legislation/ingest` — extracted here so future admin routes
 * stop copy-pasting the check.
 *
 * On success returns `null`. On failure returns a ready-to-return
 * `NextResponse` with the appropriate status (401/500) so callers can
 * early-return:
 *
 *     const denied = requireAdmin(req);
 *     if (denied) return denied;
 *
 * We deliberately do NOT log or echo the supplied key anywhere.
 */
import { NextResponse } from "next/server";
import { safeSecretEqual } from "./secret-compare";

export function requireAdmin(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Server misconfigured: ADMIN_SECRET is not set" },
      { status: 500 },
    );
  }
  const supplied = req.headers.get("x-admin-key");
  if (!safeSecretEqual(supplied, expected)) {
    return NextResponse.json(
      { error: "Unauthorized — X-Admin-Key required" },
      { status: 401 },
    );
  }
  return null;
}
