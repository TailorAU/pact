import { NextRequest, NextResponse } from "next/server";
import { getLatestPrices, searchProducts } from "@/lib/market/queries";
import { solveCart } from "@/lib/market/cart-solver";
import type { CartItem, PriceCandidate } from "@/lib/market/types";
import { log } from "@/lib/logger";
import { readBodyBounded } from "@/lib/read-body-bounded";

export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    const bounded = await readBodyBounded(request);
    if (!bounded.ok) return bounded.response;
    try {
      body = JSON.parse(bounded.text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body || typeof body !== "object" || !("items" in body)) {
      return NextResponse.json(
        { error: "Missing required field: items" },
        { status: 400 }
      );
    }

    const { items, preferPickup } = body as {
      items?: unknown;
      postcode?: string;
      preferPickup?: boolean;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items must be a non-empty array" },
        { status: 400 }
      );
    }

    const cartItems: CartItem[] = [];
    const pricesByProduct = new Map<string, PriceCandidate[]>();

    for (const raw of items) {
      if (!raw || typeof raw !== "object") {
        return NextResponse.json(
          { error: "Each item must be an object with query and quantity" },
          { status: 400 }
        );
      }
      const { query, quantity } = raw as { query?: unknown; quantity?: unknown };
      if (typeof query !== "string" || query.trim() === "") {
        return NextResponse.json(
          { error: "Each item must include a non-empty query string" },
          { status: 400 }
        );
      }
      if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json(
          { error: "Each item must include a positive numeric quantity" },
          { status: 400 }
        );
      }
      const qty = Math.floor(quantity);

      const matches = await searchProducts(query.trim(), 5);
      const product = matches[0];
      if (!product) {
        return NextResponse.json(
          { error: `No product found for query: ${query}` },
          { status: 400 }
        );
      }

      const latest = await getLatestPrices(product.id);
      pricesByProduct.set(product.id, latestToCandidates(product.id, latest));
      cartItems.push({
        productId: product.id,
        name: product.name,
        quantity: qty,
      });
    }

    const solution = solveCart(cartItems, pricesByProduct, undefined, Boolean(preferPickup));
    return NextResponse.json(solution);
  } catch (err) {
    log.error({ op: "market.cart.optimise.post.error", err }, "cart optimisation failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
