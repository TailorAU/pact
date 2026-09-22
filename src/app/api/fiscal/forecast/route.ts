import { NextRequest, NextResponse } from "next/server";
import { getFiscalForecast } from "@/lib/fiscal-queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public, no-auth: pre-registered QLD GG forecast lines (#3053).
 * The forecast node carries a confidence that rises toward the official release;
 * actualValue + accuracyScore populate once the budget is released.
 * GET /api/fiscal/forecast?fiscalYear=FY2026-27&limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fiscalYear = searchParams.get("fiscalYear") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10) || 0;

    const { lines, total, lastUpdated } = await getFiscalForecast({ fiscalYear, limit, offset });

    const params = new URLSearchParams();
    if (fiscalYear) params.set("fiscalYear", fiscalYear);
    params.set("limit", String(limit));
    const self = `/api/fiscal/forecast?${params.toString()}&offset=${offset}`;
    const next = offset + limit < total
      ? `/api/fiscal/forecast?${params.toString()}&offset=${offset + limit}`
      : undefined;

    return NextResponse.json(
      { lines, total, limit, offset, lastUpdated, _links: { self, ...(next ? { next } : {}) } },
      { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    log.error({ op: "fiscal.forecast.get.error", err }, "fiscal forecast query failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
