/**
 * Quote-rates query layer (#1192 chunk A).
 *
 * Resolves the canonical retail rate for a given set of item-keys across all
 * curator-linked retailers. Reads from market.item_key_mapping +
 * market.item_key_product_links + market.price_observations.
 *
 * The write side (chunk B: price_observation_mining work type) populates
 * market.price_observations via the consensus validator. This module is read-only.
 */

import { marketQuery } from "./db";

const STALE_THRESHOLD_DAYS = 7;

export interface QuoteRateObservation {
  retailer: string;
  retailer_name: string;
  rate_aud: number;
  price_aud: number;
  product_id: string;
  product_name: string;
  product_url: string;
  observed_at: string;
  stale: boolean;
  tier: string;
}

export interface QuoteRateEntry {
  unit: string;
  description: string;
  category: string;
  cheapest: QuoteRateObservation | null;
  observations: QuoteRateObservation[];
}

export interface QuoteRatesResponse {
  rates: Record<string, QuoteRateEntry>;
  missing: string[];
  generated_at: string;
}

interface RawRow {
  itemKey: string;
  unit: string;
  description: string;
  category: string;
  retailerSlug: string;
  retailerName: string;
  productId: string | null;
  productName: string | null;
  productUrl: string | null;
  priceCents: number | null;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  observedAt: Date | null;
  tier: string | null;
}

const STALE_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

export async function getQuoteRates(itemKeys: string[]): Promise<QuoteRatesResponse> {
  const generatedAt = new Date().toISOString();
  if (itemKeys.length === 0) {
    return { rates: {}, missing: [], generated_at: generatedAt };
  }

  // Pull every active link for the requested keys, plus the latest observation
  // for each (product, retailer) via LATERAL. Volumes are tiny (~14 keys x ~4
  // retailers = ~56 rows max), so the LATERAL is cheap.
  const rows = await marketQuery<RawRow>(
    `SELECT
      m.item_key             AS "itemKey",
      m.unit                 AS "unit",
      m.description          AS "description",
      m.category             AS "category",
      r.slug                 AS "retailerSlug",
      r.name                 AS "retailerName",
      p.id::text             AS "productId",
      p.name                 AS "productName",
      l.tier                 AS "tier",
      obs.product_url        AS "productUrl",
      obs.price_cents        AS "priceCents",
      obs.unit_price_cents   AS "unitPriceCents",
      obs.unit_price_unit    AS "unitPriceUnit",
      obs.observed_at        AS "observedAt"
    FROM market.item_key_mapping m
    JOIN market.item_key_product_links l
      ON l.item_key = m.item_key
     AND l.deprecated_at IS NULL
     AND l.is_canonical
    JOIN market.products p ON p.id = l.product_id
    JOIN market.retailers r ON r.id = l.retailer_id AND r.active
    LEFT JOIN LATERAL (
      SELECT po.product_url, po.price_cents, po.unit_price_cents,
             po.unit_price_unit, po.observed_at
      FROM market.price_observations po
      WHERE po.product_id = l.product_id
        AND po.retailer_id = l.retailer_id
      ORDER BY po.observed_at DESC
      LIMIT 1
    ) obs ON TRUE
    WHERE m.item_key = ANY($1::text[])
      AND m.deprecated_at IS NULL`,
    [itemKeys]
  );

  // Track which keys had any link at all (vs. unknown keys requested).
  const knownKeys = new Set<string>();
  // Track which keys have at least one observation (vs. linked but nobody has mined yet).
  const observedKeys = new Set<string>();

  const rates: Record<string, QuoteRateEntry> = {};
  const now = Date.now();

  for (const row of rows) {
    knownKeys.add(row.itemKey);

    if (!rates[row.itemKey]) {
      rates[row.itemKey] = {
        unit: row.unit,
        description: row.description,
        category: row.category,
        cheapest: null,
        observations: [],
      };
    }

    if (
      row.priceCents == null ||
      row.observedAt == null ||
      row.productId == null ||
      row.productName == null ||
      row.productUrl == null
    ) {
      continue; // link exists but no observation yet
    }

    // Canonical per-unit rate. Chunk-B's submit validator enforces
    // unit_price_unit === item_key.unit, so we can use unit_price_cents
    // directly when present. If the agent only supplied a raw product
    // price (no per-unit), fall back to that — caller can decide whether
    // to render it.
    const rateCents = row.unitPriceCents ?? row.priceCents;
    const observedAtMs = new Date(row.observedAt).getTime();
    const stale = now - observedAtMs > STALE_MS;

    rates[row.itemKey].observations.push({
      retailer: row.retailerSlug,
      retailer_name: row.retailerName,
      rate_aud: rateCents / 100,
      price_aud: row.priceCents / 100,
      product_id: row.productId,
      product_name: row.productName,
      product_url: row.productUrl,
      observed_at: new Date(row.observedAt).toISOString(),
      stale,
      tier: row.tier ?? "standard",
    });
    observedKeys.add(row.itemKey);
  }

  // Compute cheapest per key (prefer fresh observations; fall back to stale
  // if all observations are stale rather than returning null).
  for (const entry of Object.values(rates)) {
    const fresh = entry.observations.filter((o) => !o.stale);
    const candidates = fresh.length > 0 ? fresh : entry.observations;
    if (candidates.length > 0) {
      entry.cheapest = candidates.reduce((a, b) => (a.rate_aud <= b.rate_aud ? a : b));
    }
  }

  // missing[] = (a) requested keys with no mapping at all, plus
  //             (b) keys that are mapped but have zero observations.
  const missing: string[] = [];
  for (const key of itemKeys) {
    if (!knownKeys.has(key)) {
      missing.push(key);
    } else if (!observedKeys.has(key)) {
      missing.push(key);
      delete rates[key];
    }
  }

  return { rates, missing, generated_at: generatedAt };
}
