import { NextRequest, NextResponse } from "next/server";
import { getStationPrices } from "@/lib/market/fuel-queries";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing station id" }, { status: 400 });
    }

    const data = await getStationPrices(id);
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
