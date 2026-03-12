import { NextRequest, NextResponse } from "next/server";
import { getAgentsList } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const agents = await getAgentsList({ limit, offset });
  return NextResponse.json(agents);
}
