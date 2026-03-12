import { NextRequest, NextResponse } from "next/server";
import { getAgentDetail } from "@/lib/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const data = await getAgentDetail(agentId);

  if (!data) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
