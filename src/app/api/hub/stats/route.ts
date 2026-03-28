import { NextResponse } from "next/server";
import { getHubStats } from "@/lib/queries";

// Force-dynamic: stats must always be fresh — ISR can serve stale zeros
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getHubStats();
  return NextResponse.json(data);
}
