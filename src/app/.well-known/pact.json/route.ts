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
 * The ONE fact this handler contributes is whether this origin's deploy
 * shipped the CI-produced v2.3 conformance results document (#5567): it is
 * a static file `cd-source.yml` drops under `public/.well-known/` after
 * validating it against the run, so its presence on disk — answered ONCE
 * at module load, never per request — is exactly "this deploy shipped it".
 * The builder is told the answer and advertises `endpoints.conformanceResults`
 * only when it is `true`, so no origin ever advertises a 404 (#5539).
 *
 * Anonymous and cacheable, per the §15.1 contract: no credential is read, no
 * request field is consulted, and the document names no tenant, agent or
 * topic. The site's `/api/:path*` no-store policy does not reach this path,
 * which is correct — a discovery document that cannot be cached is a
 * discovery document nobody polls politely.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFORMANCE_RESULTS_PATH, PUBLIC_BASE_URL, buildPactProfile } from "@/lib/pact-profile";

/** Five minutes: long enough to be worth caching, short enough that a
 *  deploy's new constants reach peers promptly. */
const MAX_AGE_SECONDS = 300;

/**
 * Answered once per process. In the standalone runtime image the server's
 * working directory is `/app` and `public/` is copied beside `server.js`
 * (Dockerfile), so this is the same file Next serves at the path.
 */
const CONFORMANCE_REPORT_SHIPPED = fs.existsSync(
  path.join(process.cwd(), "public", ...CONFORMANCE_RESULTS_PATH.split("/").filter(Boolean))
);

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify(buildPactProfile(PUBLIC_BASE_URL, { conformanceReportShipped: CONFORMANCE_REPORT_SHIPPED }), null, 2),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${MAX_AGE_SECONDS}, s-maxage=${MAX_AGE_SECONDS}`,
        // A discovery document is meant to be read by peers on other origins.
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
