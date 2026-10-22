import { NextRequest, NextResponse } from "next/server";
import { getFiscalActuals } from "@/lib/fiscal-queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public, no-auth: reconstructed QLD GG operating-statement lines (#3053).
 * GET /api/fiscal/actuals?fiscalYear=FY2024-25&verdict=automate&limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fiscalYear = searchParams.get("fiscalYear") ?? undefined;
    const verdict = searchParams.get("verdict") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10) || 0;

    const { lines, total, lastUpdated } = await getFiscalActuals({ fiscalYear, verdict, limit, offset });

    const params = new URLSearchParams();
    if (fiscalYear) params.set("fiscalYear", fiscalYear);
    if (verdict) params.set("verdict", verdict);
    params.set("limit", String(limit));
    const self = `/api/fiscal/actuals?${params.toString()}&offset=${offset}`;
    const next = offset + limit < total
      ? `/api/fiscal/actuals?${params.toString()}&offset=${offset + limit}`
      : undefined;

    return NextResponse.json(
      { lines, total, limit, offset, lastUpdated, _links: { self, ...(next ? { next } : {}) } },
      { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    log.error({ op: "fiscal.actuals.get.error", err }, "fiscal actuals query failed");
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
