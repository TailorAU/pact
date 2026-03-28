import { NextRequest, NextResponse } from "next/server";
import { getDb, autoMergeExpired } from "@/lib/db";

const TIER_ORDER: Record<string, number> = { axiom: 0, convention: 1, practice: 2, policy: 3, frontier: 4 };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params;
  const resolve = req.nextUrl.searchParams.get("resolve") === "true";
  const db = await getDb();

  // Auto-merge any expired proposals
  await autoMergeExpired(db);

  const topicResult = await db.execute({
    sql: "SELECT id, title, tier, status, content FROM topics WHERE id = ?",
    args: [topicId],
  });
  const topic = topicResult.rows[0];

  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  const sectionsResult = await db.execute({
    sql: "SELECT id as sectionId, heading, level, content FROM sections WHERE topic_id = ? ORDER BY sort_order",
    args: [topicId],
  });
  const sections = sectionsResult.rows;

  if (!resolve) {
    // Original behavior — return markdown
    const markdown = `# ${topic.title}\n\n${sections.map((s) => `## ${s.heading}\n\n${s.content}`).join("\n\n")}`;
    return NextResponse.json({ content: markdown, version: 1 });
  }

  // ── Resolve axiom chain ──────────────────────────────────────────
  // Walk the dependency DAG recursively, collecting all ancestors.
  // Agents can take resolved (consensus/stable) dependencies at face
  // value — no need to re-derive from first principles.

  const visited = new Set<string>();
  const resolvedDeps: {
    id: string;
    title: string;
    tier: string;
    status: string;
    relationship: string;
    answer: string | null;
    depth: number;
  }[] = [];

  async function walkDeps(currentId: string, depth: number) {
    const deps = await db.execute({
      sql: `SELECT td.depends_on, td.relationship, t.title, t.tier, t.status
            FROM topic_dependencies td
            JOIN topics t ON t.id = td.depends_on
            WHERE td.topic_id = ?`,
      args: [currentId],
    });

    for (const dep of deps.rows) {
      const depId = dep.depends_on as string;
      if (visited.has(depId)) continue;
      visited.add(depId);

      // Fetch the Answer section content for resolved dependencies
      const depStatus = dep.status as string;
      let answer: string | null = null;

      if (["consensus", "stable", "locked"].includes(depStatus)) {
        const answerResult = await db.execute({
          sql: "SELECT content FROM sections WHERE topic_id = ? AND heading = 'Answer' LIMIT 1",
          args: [depId],
        });
        answer = (answerResult.rows[0]?.content as string) ?? null;
      }

      resolvedDeps.push({
        id: depId,
        title: dep.title as string,
        tier: dep.tier as string,
        status: depStatus,
        relationship: dep.relationship as string,
        answer,
        depth,
      });

      // Recurse into this dependency's own dependencies
      await walkDeps(depId, depth + 1);
    }
  }

  await walkDeps(topicId, 1);

  // Sort: axioms first (by tier order), then by depth
  resolvedDeps.sort((a, b) => {
    const tierDiff = (TIER_ORDER[a.tier] ?? 5) - (TIER_ORDER[b.tier] ?? 5);
    return tierDiff !== 0 ? tierDiff : a.depth - b.depth;
  });

  return NextResponse.json({
    topic: {
      id: topic.id,
      title: topic.title,
      tier: topic.tier,
      status: topic.status,
    },
    sections,
    resolvedDependencies: resolvedDeps,
  });
}
