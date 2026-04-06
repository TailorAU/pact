import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory } from "@/lib/market/queries";

export const dynamic = "force-dynamic";

function parseDays(value: string | null, defaultValue: number): number {
  if (value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const productId = searchParams.get("productId");
    if (!productId) {
      return NextResponse.json(
        { error: "Missing required query parameter: productId" },
        { status: 400 }
      );
    }

    const days = parseDays(searchParams.get("days"), 30);
    const data = await getPriceHistory(productId, days);
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
