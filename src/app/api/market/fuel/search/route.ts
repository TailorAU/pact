import { NextRequest, NextResponse } from "next/server";
import { searchFuelStations } from "@/lib/market/fuel-queries";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null, defaultValue: number): number {
  if (value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fuelType = searchParams.get("fuelType");
    if (!fuelType) {
      return NextResponse.json(
        { error: "Missing required query parameter: fuelType" },
        { status: 400 }
      );
    }

    const state = searchParams.get("state") ?? undefined;
    const suburb = searchParams.get("suburb") ?? undefined;
    const limit = parseLimit(searchParams.get("limit"), 20);

    const data = await searchFuelStations(fuelType, { state, suburb, limit });
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
