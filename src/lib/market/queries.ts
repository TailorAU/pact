/**
 * Market grocery queries — ported from @bestprice/db queries.ts
 * All table references use the market.* schema.
 */

import { marketQuery, marketQueryOne, marketExec } from "./db.js";
import type { PriceObservationInput } from "./types.js";

// ── Retailer Lookups ─────────────────────────────────────

const retailerCache = new Map<string, string>();

export async function getRetailerId(slug: string): Promise<string | null> {
  if (retailerCache.has(slug)) return retailerCache.get(slug)!;
  const row = await marketQueryOne<{ id: string }>(
    "SELECT id FROM market.retailers WHERE slug = $1 LIMIT 1",
    [slug]
  );
  if (!row) return null;
  retailerCache.set(slug, row.id);
  return row.id;
}

export async function getRetailerSlug(id: string): Promise<string | null> {
  const row = await marketQueryOne<{ slug: string }>(
    "SELECT slug FROM market.retailers WHERE id = $1::uuid LIMIT 1",
    [id]
  );
  return row?.slug ?? null;
}

// ── Price Observation Writes ─────────────────────────────

export async function insertPriceObservation(input: PriceObservationInput): Promise<void> {
  await marketExec(
    `INSERT INTO market.price_observations (
      product_id, retailer_id, price_cents, was_price_cents,
      unit_price_cents, unit_price_unit, in_stock, product_url,
      delivery_cents, promotion_text
    ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.productId, input.retailerId,
      input.priceCents, input.wasPriceCents,
      input.unitPriceCents, input.unitPriceUnit,
      input.inStock, input.productUrl,
      input.deliveryCents, input.promotionText,
    ]
  );
}

// ── Product Search ───────────────────────────────────────

export interface ProductSearchResult {
  id: string;
  name: string;
  ean: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  similarity: number;
}

export async function searchProducts(
  query: string,
  limit: number = 10
): Promise<ProductSearchResult[]> {
  return marketQuery<ProductSearchResult>(
    `SELECT
      id, name, ean, brand, category,
      image_url AS "imageUrl",
      similarity(name, $1) AS similarity
    FROM market.products
    WHERE similarity(name, $1) > 0.2
    ORDER BY similarity DESC
    LIMIT $2`,
    [query, limit]
  );
}

// ── Latest Prices ────────────────────────────────────────

export interface LatestPrice {
  retailerId: string;
  retailerName: string;
  retailerSlug: string;
  priceCents: number;
  wasPriceCents: number | null;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  deliveryCents: number | null;
  inStock: boolean;
  productUrl: string;
  promotionText: string | null;
  observedAt: Date;
}

export async function getLatestPrices(productId: string): Promise<LatestPrice[]> {
  return marketQuery<LatestPrice>(
    `SELECT DISTINCT ON (po.retailer_id)
      po.retailer_id AS "retailerId",
      r.name AS "retailerName",
      r.slug AS "retailerSlug",
      po.price_cents AS "priceCents",
      po.was_price_cents AS "wasPriceCents",
      po.unit_price_cents AS "unitPriceCents",
      po.unit_price_unit AS "unitPriceUnit",
      po.delivery_cents AS "deliveryCents",
      po.in_stock AS "inStock",
      po.product_url AS "productUrl",
      po.promotion_text AS "promotionText",
      po.observed_at AS "observedAt"
    FROM market.price_observations po
    JOIN market.retailers r ON r.id = po.retailer_id
    WHERE po.product_id = $1::uuid
    ORDER BY po.retailer_id, po.observed_at DESC`,
    [productId]
  );
}

// ── Price History ────────────────────────────────────────

export interface PriceHistoryPoint {
  retailerSlug: string;
  priceCents: number;
  observedAt: Date;
}

export async function getPriceHistory(
  productId: string,
  days: number = 30
): Promise<PriceHistoryPoint[]> {
  return marketQuery<PriceHistoryPoint>(
    `SELECT
      r.slug AS "retailerSlug",
      po.price_cents AS "priceCents",
      po.observed_at AS "observedAt"
    FROM market.price_observations po
    JOIN market.retailers r ON r.id = po.retailer_id
    WHERE po.product_id = $1::uuid
      AND po.observed_at >= now() - ($2 || ' days')::interval
    ORDER BY po.observed_at ASC`,
    [productId, String(days)]
  );
}

// ── Full-text Search with Prices ─────────────────────────

export interface SearchWithPricesResult {
  productId: string;
  name: string;
  ean: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  cheapestPriceCents: number | null;
  cheapestRetailer: string | null;
  retailerCount: number;
}

export async function searchProductsWithPrices(
  query: string,
  limit: number = 10
): Promise<SearchWithPricesResult[]> {
  return marketQuery<SearchWithPricesResult>(
    `WITH matched AS (
      SELECT id, name, ean, brand, category, image_url,
             similarity(name, $1) AS sim
      FROM market.products
      WHERE similarity(name, $1) > 0.2
      ORDER BY sim DESC
      LIMIT $2
    ),
    latest AS (
      SELECT DISTINCT ON (po.product_id, po.retailer_id)
        po.product_id,
        po.retailer_id,
        po.price_cents,
        po.delivery_cents,
        r.slug AS retailer_slug,
        po.observed_at
      FROM market.price_observations po
      JOIN market.retailers r ON r.id = po.retailer_id
      WHERE po.product_id IN (SELECT id FROM matched)
      ORDER BY po.product_id, po.retailer_id, po.observed_at DESC
    ),
    ranked AS (
      SELECT
        product_id,
        retailer_slug,
        price_cents + COALESCE(delivery_cents, 0) AS total_cents,
        ROW_NUMBER() OVER (
          PARTITION BY product_id
          ORDER BY price_cents + COALESCE(delivery_cents, 0) ASC
        ) AS rn,
        COUNT(*) OVER (PARTITION BY product_id) AS retailer_count
      FROM latest
    )
    SELECT
      m.id AS "productId",
      m.name,
      m.ean,
      m.brand,
      m.category,
      m.image_url AS "imageUrl",
      r.total_cents AS "cheapestPriceCents",
      r.retailer_slug AS "cheapestRetailer",
      r.retailer_count::int AS "retailerCount"
    FROM matched m
    LEFT JOIN ranked r ON r.product_id = m.id AND r.rn = 1
    ORDER BY m.sim DESC`,
    [query, limit]
  );
}

// ── Agent Contributions ──────────────────────────────────

export async function insertAgentContribution(input: {
  agentId: string;
  contributionType: string;
  productId: string | null;
  retailerId: string | null;
  data: Record<string, unknown>;
  creditsEarned: number;
}): Promise<void> {
  await marketExec(
    `INSERT INTO market.agent_contributions (
      agent_id, contribution_type, product_id, retailer_id, data, credits_earned
    ) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6)`,
    [
      input.agentId,
      input.contributionType,
      input.productId,
      input.retailerId,
      JSON.stringify(input.data),
      input.creditsEarned,
    ]
  );
}

export async function getMarketCatalogCounts(): Promise<{
  productCount: number;
  retailerCount: number;
}> {
  const row = await marketQueryOne<{
    productCount: string;
    retailerCount: string;
  }>(
    `SELECT
      (SELECT COUNT(*)::bigint FROM market.products) AS "productCount",
      (SELECT COUNT(*)::bigint FROM market.retailers) AS "retailerCount"`
  );
  return {
    productCount: Number(row?.productCount ?? 0),
    retailerCount: Number(row?.retailerCount ?? 0),
  };
}

export async function findOrCreateMarketAgent(externalId: string): Promise<string> {
  const existing = await marketQueryOne<{ id: string }>(
    "SELECT id FROM market.agents WHERE external_id = $1 LIMIT 1",
    [externalId]
  );
  if (existing) return existing.id;

  const created = await marketQueryOne<{ id: string }>(
    `INSERT INTO market.agents (external_id, contributor_tier)
     VALUES ($1, 'active')
     RETURNING id`,
    [externalId]
  );
  return created!.id;
}
