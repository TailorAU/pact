import { NextResponse } from "next/server";
import { getMarketCatalogCounts } from "@/lib/market/queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getMarketCatalogCounts();
    return NextResponse.json(data);
  } catch (err) {
    log.error({ op: "market.catalog.stats.get.error", err }, "catalog stats query failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
