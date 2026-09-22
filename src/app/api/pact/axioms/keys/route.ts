export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";

/**
 * POST /api/pact/axioms/keys — RETIRED (tailor-group#63).
 *
 * This duplicate of POST /api/axiom/keys minted a `pact_ax_` key with a
 * caller-chosen credit balance (up to 1,000,000), unauthenticated and without
 * a rate limit. No UI, CLI, script, workflow, MCP tool or test called it; the
 * only reference was its row in PACT_CONFORMANCE.md. It now answers 410 Gone
 * without reading the body or touching the database, and points callers at
 * the public free-tier route, which is rate-limited and grants a fixed 100
 * credits.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Gone. POST /api/pact/axioms/keys is retired. Create a free-tier key with POST /api/axiom/keys.",
      replacement: { method: "POST", url: "/api/axiom/keys", body: { ownerName: "Your Name or App" } },
    },
    { status: 410 }
  );
}
