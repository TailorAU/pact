/**
 * Ranking Engine — ported from @bestprice/ranking
 *
 * INTEGRITY GUARANTEE:
 * Sorts products by TRUE TOTAL COST only.
 * Has ZERO access to commission rates or affiliate data.
 * The affiliate module is not imported.
 */

import type { PriceCandidate } from "./types";

export interface RankingOptions {
  includeOutOfStock?: boolean;
  includeDelivery?: boolean;
  postcode?: string;
}

export function rankByTotalCost(
  candidates: PriceCandidate[],
  options: RankingOptions = {}
): PriceCandidate[] {
  const { includeOutOfStock = false, includeDelivery = true } = options;

  let filtered = candidates;
  if (!includeOutOfStock) {
    filtered = filtered.filter((c) => c.inStock);
  }

  return filtered.sort((a, b) => {
    const totalA = a.priceCents + (includeDelivery ? (a.deliveryCents ?? 0) : 0);
    const totalB = b.priceCents + (includeDelivery ? (b.deliveryCents ?? 0) : 0);
    if (totalA !== totalB) return totalA - totalB;
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    if (a.unitPriceCents != null && b.unitPriceCents != null) {
      return a.unitPriceCents - b.unitPriceCents;
    }
    return 0;
  });
}

export function cheapestPerProduct(
  candidates: PriceCandidate[]
): Map<string, PriceCandidate> {
  const ranked = rankByTotalCost(candidates, { includeDelivery: true });
  const result = new Map<string, PriceCandidate>();
  for (const c of ranked) {
    if (!result.has(c.productId)) {
      result.set(c.productId, c);
    }
  }
  return result;
}

export function detectPriceCorrelation(
  _pricesByProduct: Map<string, PriceCandidate[]>,
  _threshold: number = 0.9
): Array<{ productIds: string[]; correlation: number; retailers: string[] }> {
  // Phase 2: implement Pearson correlation on time-series data
  return [];
}
