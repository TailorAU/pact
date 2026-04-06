import { NextRequest, NextResponse } from "next/server";
import { getFuelSummary } from "@/lib/market/fuel-queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const state = searchParams.get("state") ?? undefined;

    const data = await getFuelSummary(state);
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
