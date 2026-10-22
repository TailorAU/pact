/**
 * Product Matching Engine — ported from @bestprice/matching
 *
 * Deduplicates products across retailers into canonical entries.
 * Uses EAN barcode when available, then fuzzy name + brand matching.
 */

import { marketQuery, marketQueryOne } from "./db";

export async function matchOrCreateProduct(input: {
  ean: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
}): Promise<string> {
  if (input.ean) {
    const existing = await marketQueryOne<{ id: string }>(
      "SELECT id FROM market.products WHERE ean = $1 LIMIT 1",
      [input.ean]
    );
    if (existing) return existing.id;
  }

  const fuzzy = await marketQuery<{ id: string; similarity: number }>(
    `SELECT id, similarity(name, $1) AS similarity
     FROM market.products
     WHERE similarity(name, $1) > 0.4
     ${input.brand ? "AND (brand = $2 OR brand IS NULL)" : ""}
     ORDER BY similarity DESC
     LIMIT 1`,
    input.brand ? [input.name, input.brand] : [input.name]
  );

  if (fuzzy.length > 0 && fuzzy[0].similarity > 0.6) {
    return fuzzy[0].id;
  }

  const created = await marketQueryOne<{ id: string }>(
    `INSERT INTO market.products (name, ean, brand, category, image_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.name, input.ean, input.brand, input.category, input.imageUrl]
  );

  return created!.id;
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d+\s*(ml|l|g|kg|pk|pack)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
