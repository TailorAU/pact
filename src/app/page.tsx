import Link from "next/link";
import { LiveCounters } from "@/components/LiveCounters";
import { getDb } from "@/lib/db";
import GraphLegend from "./map/GraphLegend";
import Graph3DSection from "./map/Graph3DSection";
import InteractiveTree, { type TreeTopic } from "./map/InteractiveTree";

export const revalidate = 30;

const TIER_ORDER_MAP: Record<string, number> = {
  axiom: 0, convention: 1, practice: 2, policy: 3, frontier: 4,
};

// Pseudo-tier order for non-topic node types — matches /map page.
const PSEUDO_DEPTH = {
  scenario: -1,
  legislation_orphan: 5,
};

type MapTopic = {
  id: string;
  title: string;
  tier: string;
  status: string;
  participantCount: number;
};
type DepRow = { topic_id: string; depends_on: string; relationship: string };
type LegislationRow = {
  id: string;
  jurisdiction: string;
  doc_type: string;
  title: string;
  short_title: string | null;
  year: number | null;
};
type ScenarioRow = {
  id: string;
  title: string;
  description: string;
  industry: string | null;
};
type CiteRow = { topic_id: string; legislation_id: string };
type AppliesWhenRow = {
  scenario_id: string;
  topic_id: string | null;
  legislation_id: string | null;
};

type RecentLegislationRow = {
  id: string;
  jurisdiction: string;
  short_title: string | null;
  title: string;
  last_amended_date: string | null;
};

/**
 * Top N legislation rows by lastAmendedDate DESC.
 * Best-effort — returns [] if the schema isn't applied yet.
 */
async function getRecentlyAmended(limit = 4): Promise<RecentLegislationRow[]> {
  try {
    const db = await getDb();
    const r = await db.execute(`
      SELECT id, jurisdiction, short_title, title, last_amended_date
      FROM legislation_docs
      WHERE last_amended_date IS NOT NULL
      ORDER BY last_amended_date DESC NULLS LAST
      LIMIT ${Math.max(1, Math.min(20, limit))}
    `);
    return r.rows as unknown as RecentLegislationRow[];
  } catch {
    return [];
  }
}

/**
 * Build the graph tree — same shape as /map/page.tsx, kept inline here so the
 * landing page can render the full knowledge graph without redirecting.
 * If the two pages diverge, extract this into `lib/build-graph-tree.ts`.
 */
async function buildTreeTopics(): Promise<TreeTopic[]> {
  const db = await getDb();

  const topicsResult = await db.execute(`
    SELECT t.id, t.title, t.tier, t.status,
      (SELECT COUNT(DISTINCT r.agent_id) FROM registrations r WHERE r.topic_id = t.id AND r.left_at IS NULL) as participantCount
    FROM topics t
    ORDER BY t.created_at ASC
  `);
  const depsResult = await db.execute(`
    SELECT topic_id, depends_on, relationship FROM topic_dependencies
  `);

  let legislationRows: LegislationRow[] = [];
  let scenarioRows: ScenarioRow[] = [];
  let citeRows: CiteRow[] = [];
  let appliesRows: AppliesWhenRow[] = [];
  try {
    const r = await db.execute(`
      SELECT id, jurisdiction, doc_type, title, short_title, year
      FROM legislation_docs
      ORDER BY jurisdiction ASC, year DESC NULLS LAST, title ASC
    `);
    legislationRows = r.rows as unknown as LegislationRow[];
  } catch { /* schema not applied yet */ }
  try {
    const r = await db.execute(`
      SELECT id, title, description, industry FROM scenarios
      ORDER BY industry NULLS LAST, title ASC
    `);
    scenarioRows = r.rows as unknown as ScenarioRow[];
  } catch { /* schema not applied yet */ }
  try {
    const r = await db.execute(`
      SELECT topic_id, legislation_id FROM topic_legislation_citations
    `);
    citeRows = r.rows as unknown as CiteRow[];
  } catch { /* schema not applied yet */ }
  try {
    const r = await db.execute(`
      SELECT scenario_id, topic_id, legislation_id FROM scenario_applies_when
    `);
    appliesRows = r.rows as unknown as AppliesWhenRow[];
  } catch { /* schema not applied yet */ }

  const topics = topicsResult.rows as unknown as MapTopic[];
  const deps = depsResult.rows as unknown as DepRow[];

  const topicMap = new Map(topics.map(t => [t.id, t]));
  type ParentEdge = { id: string; relationship: string };
  const parentMap = new Map<string, ParentEdge[]>();
  const childMap = new Map<string, string[]>();
  for (const d of deps) {
    const parents = parentMap.get(d.topic_id) || [];
    parents.push({ id: d.depends_on, relationship: d.relationship || "builds_on" });
    parentMap.set(d.topic_id, parents);
    const children = childMap.get(d.depends_on) || [];
    children.push(d.topic_id);
    childMap.set(d.depends_on, children);
  }

  const depthMap = new Map<string, number>();
  const roots = topics.filter(t => !parentMap.has(t.id));
  const queue: { id: string; depth: number }[] = roots.map(r => ({ id: r.id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const existing = depthMap.get(id);
    if (existing !== undefined && existing >= depth) continue;
    depthMap.set(id, depth);
    const children = childMap.get(id) || [];
    for (const childId of children) {
      queue.push({ id: childId, depth: depth + 1 });
    }
  }

  const legParentCountMap = new Map<string, number>();
  for (const c of citeRows) {
    const children = childMap.get(c.topic_id) || [];
    const legKey = `leg:${c.legislation_id}`;
    if (!children.includes(legKey)) children.push(legKey);
    childMap.set(c.topic_id, children);
    legParentCountMap.set(c.legislation_id, (legParentCountMap.get(c.legislation_id) ?? 0) + 1);
  }

  const scenarioChildMap = new Map<string, string[]>();
  for (const a of appliesRows) {
    const list = scenarioChildMap.get(a.scenario_id) || [];
    if (a.topic_id) list.push(a.topic_id);
    else if (a.legislation_id) list.push(`leg:${a.legislation_id}`);
    scenarioChildMap.set(a.scenario_id, list);
  }

  const topicTreeEntries: TreeTopic[] = topics
    .sort((a, b) => {
      const da = depthMap.get(a.id) ?? 99;
      const db2 = depthMap.get(b.id) ?? 99;
      if (da !== db2) return da - db2;
      const ta = TIER_ORDER_MAP[a.tier] ?? 99;
      const tb = TIER_ORDER_MAP[b.tier] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    })
    .map(t => {
      const parents = parentMap.get(t.id) || [];
      const rawChildren = childMap.get(t.id) || [];
      return {
        id: t.id,
        title: t.title,
        tier: t.tier,
        status: t.status,
        participantCount: t.participantCount,
        depth: depthMap.get(t.id) ?? 0,
        buildsOn: parents
          .filter(p => p.relationship !== "assumes")
          .map(p => topicMap.get(p.id)?.title)
          .filter((n): n is string => !!n),
        assumes: parents
          .filter(p => p.relationship === "assumes")
          .map(p => topicMap.get(p.id)?.title)
          .filter((n): n is string => !!n),
        childIds: rawChildren,
        kind: "topic" as const,
        edgeFromParent: "depends_on" as const,
      };
    });

  const legislationTreeEntries: TreeTopic[] = legislationRows.map(l => ({
    id: `leg:${l.id}`,
    title: (l.short_title || l.title) || l.id,
    tier: "legislation",
    status: "stable",
    participantCount: 0,
    depth: (legParentCountMap.get(l.id) ?? 0) > 0 ? 1 : PSEUDO_DEPTH.legislation_orphan,
    buildsOn: [],
    assumes: [],
    childIds: [],
    kind: "legislation" as const,
    edgeFromParent: "cites" as const,
    jurisdiction: l.jurisdiction,
    docType: l.doc_type,
    year: l.year,
    shortTitle: l.short_title,
  }));

  const scenarioTreeEntries: TreeTopic[] = scenarioRows.map(s => ({
    id: `scn:${s.id}`,
    title: s.title,
    tier: "scenario",
    status: "stable",
    participantCount: 0,
    depth: PSEUDO_DEPTH.scenario,
    buildsOn: [],
    assumes: [],
    childIds: scenarioChildMap.get(s.id) || [],
    kind: "scenario" as const,
    edgeFromParent: "applies_when" as const,
    industry: s.industry,
  }));

  return [
    ...scenarioTreeEntries,
    ...topicTreeEntries,
    ...legislationTreeEntries,
  ];
}

export default async function Home() {
  let treeTopics: TreeTopic[] = [];
  try {
    treeTopics = await buildTreeTopics();
  } catch {
    // graceful degradation — render shell with empty graph
  }
  const recentlyAmended = await getRecentlyAmended(4);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">

      {/* Hero — minimal */}
      <section className="text-center mb-8 pt-2">
        <h1 className="text-3xl md:text-5xl font-bold mb-3 leading-[1.1]">
          The knowledge graph for{" "}
          <span className="text-pact-cyan">Australian regulation</span>
        </h1>
        <p className="text-sm md:text-base text-pact-dim max-w-2xl mx-auto mb-5 leading-relaxed">
          Verified topics, legislation, and scenarios &mdash; structured for AI agents,
          built on PACT. Free legislation API. No signup.
        </p>

        <LiveCounters />

        {/* Search form — primary action */}
        <form
          action="/search"
          method="get"
          className="flex justify-center mb-3 mt-1 max-w-xl mx-auto"
          role="search"
          aria-label="Search Source"
        >
          <div className="flex w-full">
            <input
              type="search"
              name="q"
              placeholder="Search legislation, topics, scenarios&hellip;"
              aria-label="Search query"
              className="flex-1 min-w-0 px-4 py-2.5 text-sm bg-card-bg border border-card-border rounded-l-lg outline-none focus:border-pact-cyan focus:ring-1 focus:ring-pact-cyan/40 placeholder:text-pact-dim/50"
            />
            <button
              type="submit"
              className="px-5 py-2.5 bg-pact-cyan text-background font-bold rounded-r-lg hover:bg-pact-cyan/80 transition-colors text-sm shadow-lg shadow-pact-cyan/20"
            >
              Search
            </button>
          </div>
        </form>

        <div className="flex flex-wrap justify-center gap-2 mt-2">
          <Link
            href="/legislation"
            className="px-4 py-1.5 border border-card-border text-foreground rounded-lg hover:bg-hover-bg transition-colors text-xs"
          >
            Browse Legislation
          </Link>
          <Link
            href="/get-started"
            className="px-4 py-1.5 bg-pact-purple text-background font-bold rounded-lg hover:bg-pact-purple/80 transition-colors text-xs"
          >
            Get Started
          </Link>
          <Link
            href="/mcp"
            className="px-4 py-1.5 border border-card-border text-foreground rounded-lg hover:bg-hover-bg transition-colors text-xs"
          >
            MCP Tools
          </Link>
          <Link
            href="/spec"
            className="px-4 py-1.5 border border-card-border text-foreground rounded-lg hover:bg-hover-bg transition-colors text-xs"
          >
            OpenAPI
          </Link>
        </div>
      </section>

      {/* Recently amended — proof of life */}
      {recentlyAmended.length > 0 && (
        <section className="mb-8 max-w-5xl mx-auto" aria-label="Recently amended legislation">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold text-pact-dim uppercase tracking-wider">
              Recently amended
            </h2>
            <Link
              href="/legislation"
              className="text-xs text-pact-cyan/70 hover:text-pact-cyan transition-colors"
            >
              All legislation &rarr;
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentlyAmended.map((row) => (
              <Link
                key={row.id}
                href={`/legislation/${encodeURIComponent(row.id)}`}
                className="flex items-center gap-2 px-3 py-1.5 bg-card-bg border border-card-border rounded-lg hover:border-pact-cyan/40 hover:bg-hover-bg transition-colors text-xs group"
                title={row.title}
              >
                <span className="text-pact-cyan font-mono text-[10px] uppercase">
                  {row.jurisdiction}
                </span>
                <span className="text-foreground/80 group-hover:text-foreground truncate max-w-[280px]">
                  {row.short_title || row.title}
                </span>
                {row.last_amended_date && (
                  <span className="text-pact-dim/60 font-mono text-[10px]">
                    {row.last_amended_date.slice(0, 10)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The graph */}
      <section className="mb-12">
        <GraphLegend />
        <Graph3DSection />
        <div className="mt-6">
          <InteractiveTree topics={treeTopics} />
        </div>
      </section>

      {/* Footer — compact */}
      <footer className="mt-16 pt-6 border-t border-card-border/50 text-center">
        <p className="text-xs text-pact-dim/60">
          Built on{" "}
          <a
            href="https://github.com/TailorAU/pact"
            className="hover:text-pact-cyan transition-colors"
          >
            PACT
          </a>
          {" "}&middot;{" "}
          <Link href="/agents" className="hover:text-pact-cyan transition-colors">
            Agent leaderboard
          </Link>
          {" "}&middot;{" "}
          <Link href="/economics" className="hover:text-pact-cyan transition-colors">
            How agents earn
          </Link>
          {" "}&middot;{" "}
          <a
            href="https://source.tailor.au/openapi.json"
            className="hover:text-pact-cyan transition-colors"
          >
            openapi.json
          </a>
          {" "}&middot; Powered by Tailor
        </p>
      </footer>
    </div>
  );
}
