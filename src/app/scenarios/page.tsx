/**
 * #1152 Round 5c — /scenarios index page.
 *
 * Lists every scenario in the DB grouped by industry, with a predicate
 * summary tooltip (hover to see the applies-when JSON at a glance). Each
 * card links to /scenarios/[id] for the full applicability subgraph.
 *
 * Server-rendered: scenarios are public and read-heavy, and the list is
 * small enough that revalidate: 60 is plenty.
 */
import Link from "next/link";
import { listScenarios } from "@/lib/scenarios/queries";
import { getDb } from "@/lib/db";
import type { Scenario } from "@/lib/scenarios/types";

export const metadata = {
  title: "Scenarios — Source",
  description:
    "Predicate-driven applicability scenarios. Declare your situation (country, product class, export destination) and Source returns the acts, sections, and topics that apply.",
};

export const revalidate = 60;

/** Cheap-and-deterministic summariser: render the first 2-3 predicate key/value
 *  pairs so the card communicates 'applies when X = Y' without a modal. */
function summarisePredicates(p: Record<string, unknown>): string {
  const entries = Object.entries(p).slice(0, 3);
  if (entries.length === 0) return "No predicates defined";
  return entries
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k} ∈ ${v.slice(0, 3).join(" | ")}${v.length > 3 ? "…" : ""}`;
      if (typeof v === "object" && v !== null) return `${k}: …`;
      return `${k} = ${String(v)}`;
    })
    .join(" · ");
}

export default async function ScenariosIndexPage() {
  let scenarios: Scenario[] = [];
  try {
    scenarios = await listScenarios();
  } catch {
    // New schema not applied; show an empty state below.
  }

  // Count applies_when rows per scenario for a "touches N items" badge.
  const counts = new Map<string, { legislation: number; topics: number }>();
  try {
    const db = await getDb();
    const r = await db.execute(
      "SELECT scenario_id, topic_id, legislation_id FROM scenario_applies_when",
    );
    for (const row of r.rows) {
      const id = String(row.scenario_id);
      const c = counts.get(id) ?? { legislation: 0, topics: 0 };
      if (row.legislation_id) c.legislation += 1;
      else if (row.topic_id) c.topics += 1;
      counts.set(id, c);
    }
  } catch {
    // Table not yet present — skip counts.
  }

  // Group by industry, preserving insertion order from the SQL sort.
  const groups = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    const key = s.industry ?? "Uncategorised";
    const bucket = groups.get(key) ?? [];
    bucket.push(s);
    groups.set(key, bucket);
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/" className="text-pact-dim text-xs hover:text-pact-cyan mb-6 block">
        &larr; Back to Source
      </Link>

      <h1 className="text-3xl font-bold mb-2">Scenarios</h1>
      <p className="text-pact-dim max-w-3xl mb-3">
        Predicate-driven applicability. Declare your situation &mdash; country of operation, product
        class, export destination, entity size &mdash; and Source returns the legislation, topics,
        and co-applying rules that actually apply.
      </p>
      <p className="text-xs text-pact-dim/70 max-w-3xl mb-8">
        Scenarios are <em>not</em> claims: they are <strong>containers</strong> for predicates plus
        the applies_when edges that connect them to verified topics and government-sourced
        legislation. Browse below or call{" "}
        <code className="text-pact-cyan">POST /api/scenarios/match</code> to resolve programmatically.
      </p>

      {scenarios.length === 0 && (
        <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center">
          <p className="text-pact-dim">
            No scenarios are seeded in this environment yet. Seed scripts live in
            <code className="text-pact-cyan mx-1">sites/source/scripts/seed_scenarios_*.py</code>.
          </p>
        </div>
      )}

      <div className="space-y-10">
        {Array.from(groups.entries()).map(([industry, items]) => (
          <section key={industry}>
            <h2 className="text-xs uppercase tracking-[0.2em] text-pact-dim/70 mb-3 font-bold">
              {industry}
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {items.map((s) => {
                const c = counts.get(s.id);
                return (
                  <Link
                    key={s.id}
                    href={`/scenarios/${encodeURIComponent(s.id)}`}
                    className="bg-card-bg border border-card-border hover:border-pact-orange/40 transition-colors rounded-xl p-5 block group"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="font-bold text-foreground group-hover:text-pact-orange transition-colors">
                        {s.title}
                      </h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-pact-orange/30 text-pact-orange uppercase font-bold shrink-0">
                        scenario
                      </span>
                    </div>
                    {s.description && (
                      <p className="text-xs text-pact-dim mb-3 line-clamp-2">{s.description}</p>
                    )}
                    <div
                      className="text-[11px] text-pact-dim/80 font-mono bg-background/50 px-2 py-1.5 rounded mb-2 truncate"
                      title={JSON.stringify(s.predicates, null, 2)}
                    >
                      {summarisePredicates(s.predicates)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-pact-dim/70">
                      {c && c.legislation > 0 && (
                        <span>
                          <span className="text-slate-300">{c.legislation}</span> legislation
                        </span>
                      )}
                      {c && c.topics > 0 && (
                        <span>
                          <span className="text-amber-400">{c.topics}</span> topic
                          {c.topics === 1 ? "" : "s"}
                        </span>
                      )}
                      {s.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded border border-card-border/60 text-pact-dim/60"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
