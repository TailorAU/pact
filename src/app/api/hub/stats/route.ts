import { NextResponse } from "next/server";
import { getHubStats } from "@/lib/queries";
import { cache } from "@/lib/cache";

// Force-dynamic: stats must always be fresh — ISR can serve stale zeros.
// Read-through Redis cache (#1309 / MEGA-80 WS8) holds results for 30s, so
// burst traffic from the homepage hero doesn't fan out into 100s of identical
// queries. Cache layer degrades to direct fetch when Redis is unavailable.
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await cache.getOrSet("hub:stats:v1", 30, () => getHubStats());
  return NextResponse.json(data);
}
