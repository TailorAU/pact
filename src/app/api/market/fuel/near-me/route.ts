import { NextRequest, NextResponse } from "next/server";
import { getFuelNearMe } from "@/lib/market/fuel-queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

function parseNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function parseLimit(value: string | null, defaultValue: number): number {
  if (value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseRadiusKm(value: string | null, defaultValue: number): number {
  if (value === null || value === "") return defaultValue;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const lat = parseNumber(searchParams.get("latitude"));
    const lon = parseNumber(searchParams.get("longitude"));
    if (lat === null || lon === null) {
      return NextResponse.json(
        { error: "Missing or invalid query parameters: latitude, longitude" },
        { status: 400 }
      );
    }

    const fuelType = searchParams.get("fuelType") ?? "U91";
    const radiusKm = parseRadiusKm(searchParams.get("radiusKm"), 10);
    const limit = parseLimit(searchParams.get("limit"), 10);

    const data = await getFuelNearMe(lat, lon, fuelType, radiusKm, limit);
    return NextResponse.json(data);
  } catch (err) {
    log.error({ op: "market.fuel.near-me.get.error", err }, "fuel near-me query failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
