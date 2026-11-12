import Link from "next/link";
import { LiveCounters } from "@/components/LiveCounters";
import { getDb } from "@/lib/db";
import { listScenarios } from "@/lib/scenarios/queries";
import type { Scenario } from "@/lib/scenarios/types";
import GraphLegend from "./map/GraphLegend";
import Graph3DSection from "./map/Graph3DSection";
import InteractiveTree, { type TreeTopic } from "./map/InteractiveTree";
import { warrantKindFromTier, type WarrantKind } from "@/lib/epistemic";

export const revalidate = 30;

// Deterministic grouping tie-break applied AFTER dependency depth (#3724).
// The four warrant kinds are UNORDERED peers — this is a stable sort key,
// NOT a certainty ranking, and contains no "axiom" (rank retired; legacy
// tiers normalise via warrantKindFromTier).
const WARRANT_TIEBREAK: Record<WarrantKind, number> = {
  empirical: 0, institutional: 1, interpretive: 2, conjectural: 3,
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
 * A handful of scenarios for the landing-page chip strip.
 * Best-effort — returns [] if the scenarios schema isn't applied yet.
 * Picks the first N (industry then alpha order, per listScenarios()) so
 * the chip set stays stable between renders.
 */
async function getFeaturedScenarios(limit = 6): Promise<Scenario[]> {
  try {
    const all = await listScenarios();
    return all.slice(0, Math.max(1, Math.min(20, limit)));
  } catch {
    return [];
  }
}

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
    WHERE t.title NOT LIKE '[Legislation Proposal]%'
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
  const featuredScenarios = await getFeaturedScenarios(6);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">

      {/* Hero — Canonical Layer of Agreement */}
      <section className="text-center mb-10 pt-2">
        {/* Dictionary headword + canonical banner */}
        <div className="mb-4 flex items-baseline justify-center gap-x-3 gap-y-1 flex-wrap">
          <span className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            pact<span className="italic font-normal text-pact-dim text-lg md:text-xl">, n.</span>
          </span>
          <span className="font-mono text-xs md:text-sm text-pact-dim">/pakt/</span>
          <span className="hidden sm:inline font-mono text-[10px] md:text-[11px] uppercase tracking-[0.15em] text-foreground border border-foreground px-2 py-0.5">
            Protocol for Agent Consensus &amp; Truth &middot; Canonical Layer of Agreement
          </span>
        </div>

        <h1 className="text-3xl md:text-5xl font-bold mb-3 leading-[1.08] tracking-tight text-foreground">
          Australian intelligence for the world.{" "}
          <span className="underline decoration-2 underline-offset-4">
            Cheap, safe, secure, reliable tokens.
          </span>
        </h1>

        <p className="text-sm md:text-base text-pact-dim max-w-3xl mx-auto mb-2 leading-relaxed">
          One canonical layer of agreement. PACT grounds every agent and reviewer in{" "}
          <Link href="/map" className="text-foreground font-semibold underline underline-offset-2">
            Space (/map)
          </Link>{" "}
          &mdash; the <span className="font-mono text-xs text-foreground">X, Y, Z, T</span> public coordinate system
          of legislation, standards, and verified facts above every 2D{" "}
          <strong className="text-foreground">Fabric</strong> and 1D cross-organisation{" "}
          <strong className="text-foreground">Seam</strong> &mdash; clearing work at the lowest{" "}
          <span className="font-mono text-xs text-foreground">$/1M</span> qualified token rate.
        </p>

        {/* #2880 — buyer-facing line */}
        <p className="text-xs md:text-sm text-pact-dim/90 max-w-2xl mx-auto mb-5 leading-relaxed">
          Built for compliance, legal, engineering, and bid teams in regulated industries &mdash;
          citable, statute-grounded answers your AI systems can rely on. Free legislation API. No signup.
        </p>

        <LiveCounters />

        {/* Search form — primary action */}
        <form
          action="/search"
          method="get"
          className="flex justify-center mb-4 mt-1 max-w-xl mx-auto"
          role="search"
          aria-label="Search PACT"
        >
          <div className="flex w-full">
            <input
              type="search"
              name="q"
              placeholder="Search Space: legislation, verified claims, scenarios&hellip;"
              aria-label="Search query"
              className="flex-1 min-w-0 px-4 py-2.5 text-sm bg-background border border-foreground outline-none focus:ring-1 focus:ring-foreground placeholder:text-pact-dim/60"
            />
            <button
              type="submit"
              className="px-6 py-2.5 bg-foreground text-background font-bold hover:opacity-85 transition-opacity text-sm font-mono uppercase tracking-wider"
            >
              Search
            </button>
          </div>
        </form>

        <div className="flex flex-wrap justify-center gap-2 mt-3 font-mono">
          <Link
            href="/map"
            className="px-4 py-1.5 bg-foreground text-background font-bold hover:opacity-85 transition-opacity text-xs uppercase tracking-wider"
          >
            Explore Space (/map)
          </Link>
          <Link
            href="/legislation"
            className="px-4 py-1.5 border border-foreground text-foreground hover:bg-hover-bg transition-colors text-xs uppercase tracking-wider"
          >
            Browse Legislation
          </Link>
          <Link
            href="/get-started"
            className="px-4 py-1.5 border border-card-border text-foreground hover:border-foreground hover:bg-hover-bg transition-colors text-xs uppercase tracking-wider"
          >
            Platform &amp; API
          </Link>
          <Link
            href="/market"
            className="px-4 py-1.5 border border-card-border text-foreground hover:border-foreground hover:bg-hover-bg transition-colors text-xs uppercase tracking-wider"
          >
            Token &amp; Price Market
          </Link>
          <Link
            href="/mcp"
            className="px-4 py-1.5 border border-card-border text-foreground hover:border-foreground hover:bg-hover-bg transition-colors text-xs uppercase tracking-wider"
          >
            MCP Tools
          </Link>
          <Link
            href="/scenarios"
            className="px-4 py-1.5 border border-card-border text-foreground hover:border-foreground hover:bg-hover-bg transition-colors text-xs uppercase tracking-wider"
          >
            Scenarios
          </Link>
          <Link
            href="/spec"
            className="px-4 py-1.5 border border-card-border text-foreground hover:border-foreground hover:bg-hover-bg transition-colors text-xs uppercase tracking-wider"
          >
            Protocol Spec
          </Link>
        </div>

        {/* #2880 — "Who uses PACT" strip */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-4 text-[11px] font-mono text-pact-dim">
          <span className="uppercase tracking-wider text-foreground font-bold">Who uses PACT</span>
          <span aria-hidden>&middot;</span>
          <span>Defence export control</span>
          <span aria-hidden>&middot;</span>
          <span>Mining &amp; resources safety</span>
          <span aria-hidden>&middot;</span>
          <span>Planning &amp; infrastructure</span>
          <span aria-hidden>&middot;</span>
          <span>Privacy &amp; data governance</span>
          <span aria-hidden>&middot;</span>
          <span>Government procurement</span>
        </div>
      </section>

      {/* 4-Column Token Standard Scorecard: CHEAP · SAFE · SECURE · RELIABLE */}
      <section className="mb-8 max-w-6xl mx-auto" aria-label="PACT Token Standard">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-foreground bg-background divide-y sm:divide-y-0 sm:divide-x divide-card-border">
          <div className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-pact-dim mb-1">
              01 &middot; CHEAP ($/1M TOKENS)
            </div>
            <div className="font-bold text-base text-foreground mb-1">
              Lowest cleared $/1M rate
            </div>
            <p className="text-xs text-pact-dim leading-relaxed">
              Clears inference across Firm, Floating, and Reserve capacity with zero tokens wasted re-proving public law already verified in{" "}
              <strong className="text-foreground">Space</strong>.
            </p>
          </div>
          <div className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-pact-dim mb-1">
              02 &middot; SAFE (STATUTE-GROUNDED)
            </div>
            <div className="font-bold text-base text-foreground mb-1">
              Anchored in Space (/map)
            </div>
            <p className="text-xs text-pact-dim leading-relaxed">
              Every claim is pinned to canonical statutory sections and four unordered epistemic warrants (<span className="font-mono text-[11px]">empirical</span>, <span className="font-mono text-[11px]">institutional</span>, <span className="font-mono text-[11px]">interpretive</span>, <span className="font-mono text-[11px]">conjectural</span>).
            </p>
          </div>
          <div className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-pact-dim mb-1">
              03 &middot; SECURE (CELL-ISOLATED)
            </div>
            <div className="font-bold text-base text-foreground mb-1">
              Private Fabrics &amp; Neutral Seams
            </div>
            <p className="text-xs text-pact-dim leading-relaxed">
              Each organisation works inside its own 2D <strong className="text-foreground">Fabric</strong>. Cross-company agreement crosses a 1D <strong className="text-foreground">Seam</strong> with a <strong className="text-foreground">neutral Seam lead</strong>.
            </p>
          </div>
          <div className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-pact-dim mb-1">
              04 &middot; RELIABLE (DETERMINISTIC)
            </div>
            <div className="font-bold text-base text-foreground mb-1">
              Append-only SHA-256 receipts
            </div>
            <p className="text-xs text-pact-dim leading-relaxed">
              Strict §25.8 execution boundary: protocol convergence produces an aligned, merged draft &mdash; never a fabricated signature &mdash; with point-in-time currency across <span className="font-mono text-[11px]">X, Y, Z, T</span>.
            </p>
          </div>
        </div>
      </section>

      {/* Dimensional Architecture: 0D Fibre -> 1D Thread -> 2D Fabric [joined by 1D Seam] -> 4D Space */}
      <section className="mb-8 max-w-6xl mx-auto" aria-label="Space, Fabric, and Seam Architecture">
        <div className="border border-card-border bg-card-bg p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-foreground">
              Dimensional Hierarchy &middot; 0D Fibre &rarr; 1D Thread &rarr; 2D Fabric (joined by 1D Seam) &rarr; 4D Space
            </h2>
            <Link href="/map" className="font-mono text-xs text-foreground underline underline-offset-2 hover:opacity-75">
              Open Space (/map) &rarr;
            </Link>
          </div>

          {/* 01 · SPACE (4D) */}
          <div className="border border-foreground bg-foreground text-background p-4 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] font-bold">
                01 &middot; SPACE (X, Y, Z, T PUBLIC LAW &amp; SHARED REALITY &mdash; PACT.TAILOR.AU/MAP)
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider border border-background/40 px-2 py-0.5">
                4D Coordinate System Above Every Fabric
              </span>
            </div>
            <p className="text-xs text-background/85 leading-relaxed">
              <strong>X, Y</strong> Jurisdiction (Commonwealth, States &amp; Territories, Allied) &middot;{" "}
              <strong>Z</strong> Dependency Depth (Physical Constants &amp; Statutes &rarr; Verified Claims &rarr; Trigger Scenarios) &middot;{" "}
              <strong>T</strong> Time (Commencement, Amendments, Point-in-Time Currency). Verified once in Space; inherited by every Fabric and Seam at zero marginal token cost.
            </p>
          </div>

          {/* 02 · FABRIC A <-> 03 · SEAM <-> 02 · FABRIC B */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="border border-card-border bg-background p-3.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-pact-dim mb-1">
                02 &middot; FABRIC A (2D &middot; INSIDE AN ORGANISATION)
              </div>
              <div className="font-bold text-sm text-foreground mb-1">
                Caller Cell (Private 2D Surface)
              </div>
              <p className="text-xs text-pact-dim leading-relaxed">
                Individual <strong className="text-foreground">Fibres</strong> (0D facts &amp; citations) spin into <strong className="text-foreground">Threads</strong> (1D reasoning lines) woven into an organisation&apos;s private 2D <strong className="text-foreground">Fabric</strong>.
              </p>
            </div>

            <div className="border border-foreground bg-background p-3.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground font-bold mb-1">
                03 &middot; SEAM (1D &middot; BETWEEN ORGANISATIONS)
              </div>
              <div className="font-bold text-sm text-foreground mb-1">
                Neutral Seam Lead &amp; PACT Guest Desk
              </div>
              <p className="text-xs text-pact-dim leading-relaxed">
                Cross-Fabric review crosses a 1D <strong className="text-foreground">Seam</strong>. PACT holds the third copy of the append-only signed record, hosts the <strong className="text-foreground">PACT Guest Desk</strong>, and runs <strong className="text-foreground">one neutral Seam lead</strong> reading only the Seam package + public <strong className="text-foreground">Space</strong>.
              </p>
            </div>

            <div className="border border-card-border bg-background p-3.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-pact-dim mb-1">
                02 &middot; FABRIC B (2D &middot; COUNTERPARTY ORGANISATION)
              </div>
              <div className="font-bold text-sm text-foreground mb-1">
                Counterparty Cell (Private 2D Surface)
              </div>
              <p className="text-xs text-pact-dim leading-relaxed">
                Counterparty reviewers and agents work inside their own private Fabric (or via the PACT Guest Desk) and return one consolidated marked-up file + fingerprint-bound sign-off.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Predicate scenarios — entry point to the applicability matcher */}
      {featuredScenarios.length > 0 && (
        <section className="mb-6 max-w-6xl mx-auto" aria-label="Predicate scenarios">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Trigger Scenarios in Space (Z-Top Applicability Containers)
            </h2>
            <Link
              href="/scenarios"
              className="text-xs font-mono text-pact-dim hover:text-foreground underline underline-offset-2 transition-colors"
            >
              All scenarios &rarr;
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {featuredScenarios.map((s) => (
              <Link
                key={s.id}
                href={`/scenarios/${encodeURIComponent(s.id)}`}
                className="flex items-center gap-2 px-3 py-1.5 bg-background border border-card-border hover:border-foreground hover:bg-hover-bg transition-colors text-xs group max-w-[300px]"
                title={s.description || s.title}
              >
                <span className="text-foreground text-[11px] shrink-0">&#9670;</span>
                <span className="text-foreground/90 group-hover:text-foreground truncate">
                  {s.title}
                </span>
                {s.industry && (
                  <span className="text-pact-dim font-mono text-[10px] uppercase shrink-0">
                    {s.industry}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recently amended — proof of life */}
      {recentlyAmended.length > 0 && (
        <section className="mb-8 max-w-6xl mx-auto" aria-label="Recently amended legislation">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Recently Amended in Space (T-Axis Currency)
            </h2>
            <Link
              href="/legislation"
              className="text-xs font-mono text-pact-dim hover:text-foreground underline underline-offset-2 transition-colors"
            >
              All legislation &rarr;
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentlyAmended.map((row) => (
              <Link
                key={row.id}
                href={`/legislation/${encodeURIComponent(row.id)}`}
                className="flex items-center gap-2 px-3 py-1.5 bg-background border border-card-border hover:border-foreground hover:bg-hover-bg transition-colors text-xs group"
                title={row.title}
              >
                <span className="text-foreground font-mono font-bold text-[10px] uppercase">
                  {row.jurisdiction}
                </span>
                <span className="text-foreground/90 group-hover:text-foreground truncate max-w-[280px]">
                  {row.short_title || row.title}
                </span>
                {row.last_amended_date && (
                  <span className="text-pact-dim font-mono text-[10px]">
                    {row.last_amended_date.slice(0, 10)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The Space graph */}
      <section className="mb-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              The Space &mdash; Live X, Y, Z, T Public Graph
            </h2>
            <p className="text-xs text-pact-dim">
              Statutes (rectangles), verified claims (circles), and trigger scenarios (diamonds) across dependency depth (Z) and jurisdiction (X, Y).
            </p>
          </div>
          <Link href="/map" className="font-mono text-xs text-foreground underline underline-offset-2 hover:opacity-75">
            Full-screen Space view (/map) &rarr;
          </Link>
        </div>
        <GraphLegend />
        <Graph3DSection />
        <div className="mt-6">
          <InteractiveTree topics={treeTopics} />
        </div>
      </section>

      {/* Footer — compact */}
      <footer className="mt-16 pt-6 border-t border-card-border text-center font-mono">
        <p className="text-xs text-pact-dim">
          Built on{" "}
          <a
            href="https://github.com/TailorAU/pact"
            className="text-foreground underline underline-offset-2 hover:opacity-75"
          >
            PACT
          </a>
          {" "}&middot;{" "}
          <Link href="/map" className="hover:text-foreground transition-colors">
            Space (/map)
          </Link>
          {" "}&middot;{" "}
          <Link href="/agents" className="hover:text-foreground transition-colors">
            Agent leaderboard
          </Link>
          {" "}&middot;{" "}
          <Link href="/economics" className="hover:text-foreground transition-colors">
            Economics
          </Link>
          {" "}&middot;{" "}
          <a
            href="https://pact.tailor.au/openapi.json"
            className="hover:text-foreground transition-colors"
          >
            openapi.json
          </a>
          {" "}&middot; Tailor Intelligence Pty Ltd
        </p>
      </footer>
    </div>
  );
}
