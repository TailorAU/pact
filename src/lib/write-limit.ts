// Per-key write limit for authenticated PACT mutations (tailor-group#7).
//
// Registration is open (proof-of-work, not a quota — see
// lib/registration-pow.ts), so the abuse control moves to where the writes
// happen: every mutation an agent key can perform draws from the same
// `write` window (30/min per key, lib/rate-limit.ts). topics / proposals /
// vote / legislation-propose already did; the routes below did not, which
// left join, done, dependencies, verify, approve/reject/object, escalate,
// bounty, salience, constraints, intents and join-token unmetered.
//
//     const limited = await enforceWriteLimit(agent.id);
//     if (limited) return limited;

import { NextResponse } from "next/server";
import { rateLimit, getRateLimitHeaders } from "./rate-limit";

export async function enforceWriteLimit(agentId: string): Promise<NextResponse | null> {
  const rl = await rateLimit(agentId, "write");
  if (rl.allowed) return null;
  return NextResponse.json(
    { error: "Rate limit exceeded. Try again later." },
    { status: 429, headers: getRateLimitHeaders(rl) }
  );
}
