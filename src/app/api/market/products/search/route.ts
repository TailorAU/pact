import { NextRequest, NextResponse } from "next/server";
import { searchProductsWithPrices } from "@/lib/market/queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null, defaultValue: number): number {
  if (value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("query");
    if (!query) {
      return NextResponse.json(
        { error: "Missing required query parameter: query" },
        { status: 400 }
      );
    }

    const category = searchParams.get("category");
    const limit = parseLimit(searchParams.get("limit"), 10);

    let data = await searchProductsWithPrices(query, limit);
    if (category) {
      const catLower = category.toLowerCase();
      data = data.filter(
        (row) => row.category?.toLowerCase().includes(catLower) ?? false
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    log.error({ op: "market.products.search.get.error", err }, "product search query failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
