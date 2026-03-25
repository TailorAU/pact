import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { createHash, randomBytes } from "crypto";

// POST: Create a new commercial API key for the Axiom Toll Road
export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ownerName, credits } = body as { ownerName?: string; credits?: number };

  if (!ownerName || typeof ownerName !== "string" || ownerName.length < 2) {
    return NextResponse.json({ error: "ownerName is required (min 2 chars)" }, { status: 400 });
  }
  if (ownerName.length > 128) {
    return NextResponse.json({ error: "ownerName must be 128 chars or fewer" }, { status: 400 });
  }

  const creditBalance = (credits && typeof credits === "number" && credits > 0) ? Math.floor(credits) : 100;
  if (creditBalance > 1000000) {
    return NextResponse.json({ error: "credits must be <= 1,000,000" }, { status: 400 });
  }

  const db = await getDb();

  const keyId = uuid();
  const secret = `pact_ax_${randomBytes(24).toString("hex")}`;
  const secretHash = createHash("sha256").update(secret).digest("hex");

  await db.execute({
    sql: "INSERT INTO api_keys (id, owner_name, secret_hash, credit_balance) VALUES (?, ?, ?, ?)",
    args: [keyId, ownerName.slice(0, 128), secretHash, creditBalance],
  });

  return NextResponse.json({
    keyId,
    secret,
    creditBalance,
    message: "API key created. Use as: Authorization: Bearer <secret>. This secret is shown once — save it.",
  }, { status: 201 });
}
