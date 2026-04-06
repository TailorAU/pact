import { NextRequest, NextResponse } from "next/server";
import { getFuelPriceHistory } from "@/lib/market/fuel-queries";

export const dynamic = "force-dynamic";

function parseDays(value: string | null, defaultValue: number): number {
  if (value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const stationId = searchParams.get("stationId");
    const fuelType = searchParams.get("fuelType");
    if (!stationId || !fuelType) {
      return NextResponse.json(
        { error: "Missing required query parameters: stationId, fuelType" },
        { status: 400 }
      );
    }

    const days = parseDays(searchParams.get("days"), 30);
    const data = await getFuelPriceHistory(stationId, fuelType, days);
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
