// Shared CORS preamble for Source's free, unauthenticated, GET-only public
// surfaces — Australian legislation (`/api/axiom/legislation*`) and the ACARA
// v9 / EYLF curriculum API (`/api/curriculum`). Both are designed to be read
// browser-side from other origins (agents, embedded UIs, third-party apps).
// No credentials are ever sent on these surfaces, so `*` is the correct,
// safe allow-origin per the CORS spec.
//
// Without these headers a browser-side `fetch("https://pact.tailor.au/...")`
// from a different origin is blocked at the browser, even though the server
// would happily return the data — see #2609 (curriculum) and #2738
// (legislation parity).
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // `*` (not an explicit list) so non-safelisted request headers the browser
  // attaches — e.g. the consumer's OpenTelemetry `traceparent`/`tracestate` —
  // pass preflight. Valid because these APIs send no credentials (ACAO is `*`).
  // An explicit list silently breaks the moment the client adds a trace header.
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// Standard preflight handler — wire as `export const OPTIONS = corsPreflight`
// in each public route module.
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Merge the CORS preamble into an existing response. Use on every Response
// emitted by a public route so cross-origin GETs see the headers on the
// actual response, not just the preflight.
export function withCors<T extends Response>(res: T): T {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}
