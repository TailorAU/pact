/**
 * GET /api/market/quote-rates?items=key1,key2,...
 *
 * Returns canonical retail rates for the requested item-keys across all
 * curator-linked retailers, with cheapest per key surfaced for default use
 * and full observations[] for refinement (#1192 chunk A).
 *
 * Public, unauthenticated — retail prices are public market data
 * (consistent with other /api/market/* routes).
 *
 * Cache: 1h client/CDN per the issue body. Traide additionally caches 24h.
 */
import { NextRequest, NextResponse } from "next/server";
import { getQuoteRates } from "@/lib/market/quote-rates";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_KEYS = 64;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const raw = searchParams.get("items");
    if (!raw) {
      return NextResponse.json(
        {
          error:
            "Missing required query parameter: items (comma-separated item keys, e.g. items=wall-tile-porcelain,grout-floor)",
        },
        { status: 400 }
      );
    }

    const items = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "items parameter must contain at least one key" },
        { status: 400 }
      );
    }

    if (items.length > MAX_KEYS) {
      return NextResponse.json(
        { error: `items parameter exceeds max of ${MAX_KEYS} keys` },
        { status: 400 }
      );
    }

    const data = await getQuoteRates(items);
    return NextResponse.json(data, {
      headers: {
        // 1h browser/CDN cache + 5min stale-while-revalidate
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    log.error({ op: "market.quote-rates.get.error", err }, "[quote-rates] query failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
