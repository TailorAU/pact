// Source — Next.js proxy (formerly "middleware").
//
// Next 16 renamed the request-rewriting Edge convention from `middleware.ts`
// to `proxy.ts` (the old filename still works but emits a deprecation
// warning at build time). Same Edge-runtime contract, same matcher config,
// the entry export is now `proxy` instead of `middleware`.
//
// Two jobs run here on every request:
//
// 1. WS1 — mint a UUID per request and propagate it to route handlers
//    + the client.
//
//    - `x-request-id` on the **request headers** so Node-runtime route
//      handlers can read it via `headers()` and bind it into AsyncLocalStorage
//      for the structured logger (see
//      `src/lib/logger.ts` § runWithRequestId / withRequestId).
//    - `x-request-id` on the **response headers** so the caller (Cloudflare,
//      a debugger, an automated agent) can correlate their trace with our
//      logs.
//
// 2. WS3 — origin lock-down via shared header. Cloudflare sits in front of
//    `pact.tailor.au`; once Knox cuts the DNS over, ACA still holds a
//    public FQDN that bypasses the edge. The `x-origin-secret` header,
//    injected by a Cloudflare Transform Rule and validated against the
//    `ORIGIN_SHARED_SECRET` env var here, ensures every production request
//    actually transited the edge (cache rules, WAF, DDoS posture all
//    apply). Direct hits to the ACA FQDN that miss the header are rejected
//    with 403 — see `sites/source/docs/CDN.md` § Origin lock-down.
//
//    Forward-compatible by design: when `ORIGIN_SHARED_SECRET` is unset
//    (local dev, PR previews, the period before Knox provisions the
//    Cloudflare zone), the check no-ops and every request is allowed.
//    The same proxy ships through every environment without code
//    branches.
//
// AsyncLocalStorage cannot be initialised here — `node:async_hooks` is a
// Node-only API, and Next 16 proxy/middleware runs in Edge by spec. The ALS
// binding therefore lives in `src/lib/logger.ts` and is invoked from
// Node-runtime route handlers via `runWithRequestId()`. This file's job is
// purely transport: mint, propagate, respond.
//
// If the caller has already supplied an `x-request-id` (e.g. an upstream
// CDN like Cloudflare, or an agent retrying with a known correlation
// handle) we pass it through unchanged. This keeps cross-system correlation
// working end-to-end.

import { NextRequest, NextResponse } from "next/server";

const REQUEST_ID_HEADER = "x-request-id";
const ORIGIN_SECRET_HEADER = "x-origin-secret";

export function proxy(request: NextRequest): NextResponse {
  // ─── Origin lock-down (WS3) ─────────────────────────────────────────
  // When the env var is set, every request must carry a matching
  // `x-origin-secret` header — Cloudflare's Transform Rule injects it
  // for traffic that transited the edge. When unset, allow all (forward-
  // compatible: dev + pre-cutover + PR previews never see the env var).
  const expectedOriginSecret = process.env.ORIGIN_SHARED_SECRET;
  if (expectedOriginSecret && expectedOriginSecret.length > 0) {
    const supplied = request.headers.get(ORIGIN_SECRET_HEADER);
    if (supplied !== expectedOriginSecret) {
      // Plain 403 — no detail in the body. A direct ACA hit is
      // unambiguously not-from-Cloudflare; surfacing the reason would
      // help an attacker enumerate the lock-down state without helping
      // a legitimate caller (legitimate callers always go via the
      // edge and never see this path).
      return new NextResponse(null, { status: 403 });
    }
  }

  // ─── Request ID minting (WS1) ───────────────────────────────────────
  // Honour any caller-supplied request id; otherwise mint a fresh one. The
  // Edge runtime exposes `crypto.randomUUID()` via the Web Crypto API.
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId =
    incoming && incoming.length > 0 ? incoming : crypto.randomUUID();

  // Propagate to downstream route handlers via mutated request headers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Echo to the client so they can quote it when reporting issues.
  response.headers.set(REQUEST_ID_HEADER, requestId);

  return response;
}

// Apply to API + page routes; skip Next internals + static assets so we
// don't burn an Edge invocation on every CSS/JS chunk.
export const config = {
  matcher: [
    // Run on everything except:
    //   /_next/static, /_next/image  — bundled assets
    //   favicon.ico, robots.txt, sitemap.xml — root files
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
