/**
 * Cart Solver — ported from @bestprice/cart-solver
 *
 * Multi-retailer cart optimisation: finds the cheapest way to buy
 * a shopping list, splitting across retailers with delivery fee logic.
 */

import type { PriceCandidate, CartItem, CartSolution } from "./types.js";

export interface DeliveryRule {
  retailerSlug: string;
  freeDeliveryThresholdCents: number | null;
  flatDeliveryCents: number;
  pickupAvailable: boolean;
}

const defaultDeliveryRules: DeliveryRule[] = [
  { retailerSlug: "coles", freeDeliveryThresholdCents: 13000, flatDeliveryCents: 700, pickupAvailable: true },
  { retailerSlug: "woolworths", freeDeliveryThresholdCents: 15000, flatDeliveryCents: 800, pickupAvailable: true },
  { retailerSlug: "amazon-au", freeDeliveryThresholdCents: 7900, flatDeliveryCents: 599, pickupAvailable: false },
];

export function solveCart(
  items: CartItem[],
  pricesByProduct: Map<string, PriceCandidate[]>,
  deliveryRules: DeliveryRule[] = defaultDeliveryRules,
  preferPickup: boolean = false
): CartSolution {
  const assignments = new Map<string, Array<CartItem & { priceCents: number; retailerName: string }>>();

  for (const item of items) {
    const prices = pricesByProduct.get(item.productId) ?? [];
    const cheapest = prices
      .filter((p) => p.inStock)
      .sort((a, b) => a.priceCents - b.priceCents)[0];
    if (!cheapest) continue;

    const slug = cheapest.retailerSlug;
    if (!assignments.has(slug)) assignments.set(slug, []);
    assignments.get(slug)!.push({
      ...item,
      priceCents: cheapest.priceCents,
      retailerName: cheapest.retailerName,
    });
  }

  const retailerOrders = [...assignments.entries()].map(([slug, orderItems]) => {
    const subtotalCents = orderItems.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
    const rule = deliveryRules.find((r) => r.retailerSlug === slug);
    let deliveryCents = 0;

    if (rule && !preferPickup) {
      if (rule.freeDeliveryThresholdCents === null || subtotalCents < rule.freeDeliveryThresholdCents) {
        deliveryCents = rule.flatDeliveryCents;
      }
    }

    return {
      retailerSlug: slug,
      retailerName: orderItems[0]?.retailerName ?? slug,
      items: orderItems.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        priceCents: i.priceCents,
      })),
      subtotalCents,
      deliveryCents,
      totalCents: subtotalCents + deliveryCents,
    };
  });

  const grandTotalCents = retailerOrders.reduce((s, o) => s + o.totalCents, 0);

  const allPrices = items.flatMap((item) => {
    const prices = pricesByProduct.get(item.productId) ?? [];
    return prices.map((p) => ({ ...p, quantity: item.quantity }));
  });

  const byRetailer = new Map<string, number>();
  for (const p of allPrices) {
    byRetailer.set(p.retailerSlug, (byRetailer.get(p.retailerSlug) ?? 0) + p.priceCents * p.quantity);
  }

  const cheapestSingle = Math.min(...[...byRetailer.values()].map((v) => v || Infinity));
  const singleRetailerCostCents = isFinite(cheapestSingle) ? cheapestSingle : grandTotalCents;

  return {
    retailerOrders,
    grandTotalCents,
    singleRetailerCostCents,
    savingsCents: Math.max(0, singleRetailerCostCents - grandTotalCents),
  };
}
