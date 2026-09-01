import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, withTransaction } from "@/lib/db";
import { requireAgent } from "@/lib/auth";
import { readBodyBounded } from "@/lib/read-body-bounded";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  let agent;
  try { agent = await requireAgent(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  let body;
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { sectionId, message } = body;

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const db = await getDb();
  // #5599 PR-A — mutating region in ONE transaction so the §6.4 chain link
  // is assigned atomically with the operation it records.
  await withTransaction(db, async (tx) => {
    await emitEvent(tx, topicId, "pact.escalation.created", agent.id, sectionId, { message });
  });

  return NextResponse.json({ status: "escalated", message });
}
