import { NextRequest, NextResponse } from "next/server";
import { getFiscalSummary } from "@/lib/fiscal-queries";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public, no-auth: headline summary of the QLD reconstruction (#3053).
 * GET /api/fiscal/summary?fiscalYear=FY2024-25
 * Single object (no pagination), the hub/stats shape.
 */
export async function GET(request: NextRequest) {
  try {
    const fiscalYear = request.nextUrl.searchParams.get("fiscalYear") ?? "FY2024-25";
    const data = await getFiscalSummary(fiscalYear);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    log.error({ op: "fiscal.summary.get.error", err }, "fiscal summary query failed");
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
