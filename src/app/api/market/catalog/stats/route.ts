import { NextResponse } from "next/server";
import { getMarketCatalogCounts } from "@/lib/market/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getMarketCatalogCounts();
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
