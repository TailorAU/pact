import { NextRequest, NextResponse } from "next/server";
import { safeSecretEqual } from "@/lib/secret-compare";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

/**
 * Read-only production proof for the CRON_SECRET bearer contract.
 *
 * This route deliberately has no database or other service dependency, so a
 * successful response proves only that the deployed cron credential matches.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (!safeSecretEqual(req.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ status: "ok" }, { headers: NO_STORE_HEADERS });
}
