import { NextRequest, NextResponse } from "next/server";
import { getLatestPrices } from "@/lib/market/queries";
import { rankByTotalCost } from "@/lib/market/ranking";
import { tagRankedResults } from "@/lib/market/affiliate";
import type { PriceCandidate } from "@/lib/market/types";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

function parseIncludeDelivery(value: string | null, defaultValue: boolean): boolean {
  if (value === null || value === "") return defaultValue;
  const v = value.toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  if (v === "true" || v === "1" || v === "yes") return true;
  return defaultValue;
}

function latestToCandidates(
  productId: string,
  latest: Awaited<ReturnType<typeof getLatestPrices>>
): PriceCandidate[] {
  return latest.map((lp) => ({
    productId,
    retailerSlug: lp.retailerSlug,
    retailerName: lp.retailerName,
    priceCents: lp.priceCents,
    deliveryCents: lp.deliveryCents ?? 0,
    unitPriceCents: lp.unitPriceCents,
    unitPriceUnit: lp.unitPriceUnit,
    inStock: lp.inStock,
    productUrl: lp.productUrl,
    promotionText: lp.promotionText,
  }));
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

    const includeDelivery = parseIncludeDelivery(searchParams.get("includeDelivery"), true);

    const latest = await getLatestPrices(productId);
    const candidates = latestToCandidates(productId, latest);
    const ranked = rankByTotalCost(candidates, { includeDelivery });
    const tagged = tagRankedResults(ranked);

    return NextResponse.json(tagged);
  } catch (err) {
    log.error({ op: "market.products.compare.get.error", err }, "product price comparison failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
