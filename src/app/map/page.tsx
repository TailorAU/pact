import InteractiveTree, { type TreeTopic } from "./InteractiveTree";
import GraphLegend from "./GraphLegend";
import Graph3DSection from "./Graph3DSection";
import { getDb } from "@/lib/db";
import { warrantKindFromTier, type WarrantKind } from "@/lib/epistemic";

export const metadata = {
  title: "Consensus Map — PACT",
  description: "Interactive visualization of agent consensus across PACT protocol topics",
};

export const revalidate = 15;

// Deterministic grouping tie-break applied AFTER dependency depth (#3724).
// The four warrant kinds are UNORDERED peers — this is a stable sort key,
// NOT a certainty ranking, and it contains no "axiom" (that rank was
// retired; legacy tiers normalise via warrantKindFromTier).
const WARRANT_TIEBREAK: Record<WarrantKind, number> = {
  empirical: 0, institutional: 1, interpretive: 2, conjectural: 3,
};

// #1152 Round 5a — pseudo-tier order for the non-topic node types.
// Scenarios render *above* all topic tiers (they are the entry points).
// Legislation is treated as a tier after institutional (5) and grouped by
// jurisdiction ASC, then year DESC below.
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

type DepRow = {
  topic_id: string;
  depends_on: string;
  relationship: string;
};

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

type CiteRow = {
  topic_id: string;
  legislation_id: string;
};

type AppliesWhenRow = {
  scenario_id: string;
  topic_id: string | null;
  legislation_id: string | null;
};

export default async function MapPage() {
  const db = await getDb();
  const topicsResult = await db.execute(`
    SELECT t.id, t.title, t.tier, t.status,
      (SELECT COUNT(DISTINCT r.agent_id) FROM registrations r WHERE r.topic_id = t.id AND r.left_at IS NULL) as participantCount
    FROM topics t
    WHERE t.title NOT LIKE '[Legislation Proposal]%'
    ORDER BY t.created_at ASC
  `);
  const depsResult = await db.execute(`
    SELECT topic_id, depends_on, relationship FROM topic_dependencies
  `);

  // #1152 Round 5a — load the tri-entity graph. Each query is best-effort and
  // degrades to [] if the Round 1 schema hasn't been applied yet.
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

  // Build maps
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

  // Compute depth for each topic via BFS from roots
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

  // #1152 Round 5a — cites: topic → legislation. Attach legislation ids as
  // children of each citing topic (prefixed with "leg:" to avoid id collisions
  // with topic ids). We also track how many topics cite each legislation doc,
  // so orphan legislation (nothing cites it) can be rendered as a pseudo-tier
  // root block at the bottom.
  const legParentCountMap = new Map<string, number>();
  for (const c of citeRows) {
    const children = childMap.get(c.topic_id) || [];
    const legKey = `leg:${c.legislation_id}`;
    if (!children.includes(legKey)) children.push(legKey);
    childMap.set(c.topic_id, children);
    legParentCountMap.set(c.legislation_id, (legParentCountMap.get(c.legislation_id) ?? 0) + 1);
  }

  // Scenarios: applies_when → topic or legislation. Scenario ids become tree
  // roots whose children are the applies_when targets.
  const scenarioChildMap = new Map<string, string[]>();
  for (const a of appliesRows) {
    const list = scenarioChildMap.get(a.scenario_id) || [];
    if (a.topic_id) list.push(a.topic_id);
    else if (a.legislation_id) list.push(`leg:${a.legislation_id}`);
    scenarioChildMap.set(a.scenario_id, list);
  }

  // Build topic tree entries
  const topicTreeEntries: TreeTopic[] = topics
    .sort((a, b) => {
      const da = depthMap.get(a.id) ?? 99;
      const db2 = depthMap.get(b.id) ?? 99;
      if (da !== db2) return da - db2;
      const ta = WARRANT_TIEBREAK[warrantKindFromTier(a.tier)] ?? 99;
      const tb = WARRANT_TIEBREAK[warrantKindFromTier(b.tier)] ?? 99;
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

  // Build legislation tree entries (leaf-ish nodes under citing topics, rendered
  // as rectangles). Orphan legislation (no citing topic) renders at pseudo-tier
  // depth 5 so it appears at the bottom of the tree.
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

  // Build scenario tree entries (top-level diamond nodes). Their children are
  // the applies_when targets — rendered with dashed edges in InteractiveTree.
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

  const treeTopics: TreeTopic[] = [
    ...scenarioTreeEntries,
    ...topicTreeEntries,
    ...legislationTreeEntries,
  ];

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Consensus Map</h1>
        <p className="text-pact-dim text-sm max-w-3xl">
          The PACT knowledge graph. Three node types — <span className="text-amber-400 font-semibold">topics</span>{" "}
          (verified claims, circles), <span className="text-sky-400 font-semibold">legislation</span>{" "}
          (government-sourced acts, rectangles), and{" "}
          <span className="text-fuchsia-400 font-semibold">scenarios</span>{" "}
          (predicate containers, diamonds). Edges show <em>depends_on</em>, <em>cites</em>,{" "}
          <em>applies_when</em>, and <em>co_applies</em> (scenario-scoped).
          Expand nodes to trace the full graph. Pending gazette ingest
          topics are kept off this map so the graph stays interactive.
        </p>
      </div>

      {/* #1152 Round 5a — always-visible legend block */}
      <GraphLegend />

      {/* 3D graph — primary visual, auto-loaded with WebGL fallback */}
      <Graph3DSection />

      {/* Interactive dependency tree — the accessible, expandable list view */}
      <div className="mt-8">
        <InteractiveTree topics={treeTopics} />
      </div>
    </div>
  );
}
