/**
 * `GET /.well-known/pact.json` — the KG's §15.1 Implementation Profile
 * (#5563).
 *
 * A route handler, deliberately, and NOT a file in `public/.well-known/`.
 * The two static documents that already live there (`agent-card.json`,
 * `ai-plugin.json`) are hand-maintained and can drift from the engine
 * without anything noticing; this one is generated from
 * `@/lib/pact-profile`, which imports every value it advertises from the
 * module that enforces it. Change `CONSENSUS_RATIO` and the wire changes.
 *
 * The handler itself holds no policy. All of it — the resource types, the
 * §25 capability flags, the `au.tailor.pact/epistemics` parameters and the
 * declared gaps — is built by `buildPactProfile()`, so the profile is
 * testable without a server and identical for every caller.
 *
 * Anonymous and cacheable, per the §15.1 contract: no credential is read, no
 * request field is consulted, and the document names no tenant, agent or
 * topic. The site's `/api/:path*` no-store policy does not reach this path,
 * which is correct — a discovery document that cannot be cached is a
 * discovery document nobody polls politely.
 */

import { buildPactProfile } from "@/lib/pact-profile";

/** Five minutes: long enough to be worth caching, short enough that a
 *  deploy's new constants reach peers promptly. */
const MAX_AGE_SECONDS = 300;

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify(buildPactProfile(), null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${MAX_AGE_SECONDS}, s-maxage=${MAX_AGE_SECONDS}`,
      // A discovery document is meant to be read by peers on other origins.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
