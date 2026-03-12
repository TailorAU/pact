import { NextRequest, NextResponse } from "next/server";
import { getDb, emitEvent, wouldCreateCycle, VALID_RELATIONSHIPS } from "@/lib/db";
import { requireAgent } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const db = await getDb();

  const deps = await db.execute({
    sql: `SELECT td.depends_on, td.relationship, t.title, t.status, t.tier
      FROM topic_dependencies td
      JOIN topics t ON t.id = td.depends_on
      WHERE td.topic_id = ?`,
    args: [topicId],
  });

  const dependents = await db.execute({
    sql: `SELECT td.topic_id, td.relationship, t.title, t.status, t.tier
      FROM topic_dependencies td
      JOIN topics t ON t.id = td.topic_id
      WHERE td.depends_on = ?`,
    args: [topicId],
  });

  // Split by relationship type
  const assumptions = deps.rows.filter((r) => r.relationship === "assumes");
  const buildsOn = deps.rows.filter((r) => r.relationship !== "assumes");
  const assumedBy = dependents.rows.filter((r) => r.relationship === "assumes");
  const usedBy = dependents.rows.filter((r) => r.relationship !== "assumes");

  return NextResponse.json({
    assumptions,
    buildsOn,
    assumedBy,
    usedBy,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;

  let agent;
  try {
    agent = await requireAgent(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dependsOn, relationship } = body;
  if (!dependsOn) {
    return NextResponse.json({ error: "dependsOn (topic ID) is required" }, { status: 400 });
  }

  // Validate relationship type
  const rel = relationship ?? "builds_on";
  if (!VALID_RELATIONSHIPS.includes(rel as typeof VALID_RELATIONSHIPS[number])) {
    return NextResponse.json(
      { error: `Invalid relationship type. Must be one of: ${VALID_RELATIONSHIPS.join(", ")}` },
      { status: 400 }
    );
  }

  const db = await getDb();

  // Verify both topics exist
  const topic = await db.execute({ sql: "SELECT id FROM topics WHERE id = ?", args: [topicId] });
  if (!topic.rows[0]) return NextResponse.json({ error: "Topic not found" }, { status: 404 });

  const dep = await db.execute({ sql: "SELECT id, status FROM topics WHERE id = ?", args: [dependsOn] });
  if (!dep.rows[0]) return NextResponse.json({ error: "Dependency topic not found" }, { status: 404 });

  // The dependency should ideally be a locked (consensus) truth
  const depStatus = dep.rows[0].status as string;
  const warning = depStatus !== "locked"
    ? "Warning: The dependency topic has not yet achieved consensus. This chain is only as strong as its weakest link."
    : undefined;

  // Prevent circular dependencies (BFS traversal)
  if (await wouldCreateCycle(db, topicId, dependsOn)) {
    return NextResponse.json({ error: "Adding this dependency would create a circular chain" }, { status: 400 });
  }

  try {
    await db.execute({
      sql: "INSERT INTO topic_dependencies (topic_id, depends_on, relationship) VALUES (?, ?, ?)",
      args: [topicId, dependsOn, rel],
    });
  } catch {
    return NextResponse.json({ error: "Dependency already exists" }, { status: 409 });
  }

  await emitEvent(db, topicId, "pact.dependency.declared", agent.id, "", {
    dependsOn,
    relationship: rel,
  });

  return NextResponse.json({
    topicId,
    dependsOn,
    relationship: rel,
    ...(warning ? { warning } : {}),
  }, { status: 201 });
}
