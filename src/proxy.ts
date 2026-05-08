// Source — Next.js proxy (formerly "middleware").
//
// Next 16 renamed the request-rewriting Edge convention from `middleware.ts`
// to `proxy.ts` (the old filename still works but emits a deprecation
// warning at build time). Same Edge-runtime contract, same matcher config,
// the entry export is now `proxy` instead of `middleware`.
//
// Job for WS1: mint a UUID per request and propagate it to route handlers
// + the client.
//
//   - `x-request-id` on the **request headers** so Node-runtime route
//     handlers can read it via `headers()` and bind it into AsyncLocalStorage
//     for the structured logger (see
//     `src/lib/logger.ts` § runWithRequestId / withRequestId).
//   - `x-request-id` on the **response headers** so the caller (Cloudflare,
//     a debugger, an automated agent) can correlate their trace with our
//     logs.
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

export function proxy(request: NextRequest): NextResponse {
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
