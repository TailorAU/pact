/**
 * #1152 Round 5c — /scenarios index page.
 * #1160 Round 5 — cluster filters + jurisdiction badge + source_ref link,
 *   refactored to delegate card rendering + filter state to a client island.
 *
 * Server loads scenarios + edge counts; the client component owns cluster
 * filter UI. Keeps the page SSR-friendly (first paint has all scenarios) and
 * avoids leaking DB access to the browser.
 */
import Link from "next/link";
import { listScenarios } from "@/lib/scenarios/queries";
import { getDb } from "@/lib/db";
import type { Scenario } from "@/lib/scenarios/types";
import { ClusterSummaryStrip, ScenariosExplorer } from "./scenarios-explorer";

export const metadata = {
  title: "Scenarios — Source",
  description:
    "Predicate-driven applicability scenarios. Declare your situation (country, product class, export destination) and Source returns the acts, sections, and topics that apply.",
};

export const revalidate = 60;

export default async function ScenariosIndexPage() {
  let scenarios: Scenario[] = [];
  try {
    scenarios = await listScenarios();
  } catch {
    /* schema not applied yet */
  }

  const countsMap: Record<string, { legislation: number; topics: number }> = {};
  try {
    const db = await getDb();
    const r = await db.execute(
      "SELECT scenario_id, topic_id, legislation_id FROM scenario_applies_when",
    );
    for (const row of r.rows) {
      const id = String(row.scenario_id);
      const c = countsMap[id] ?? { legislation: 0, topics: 0 };
      if (row.legislation_id) c.legislation += 1;
      else if (row.topic_id) c.topics += 1;
      countsMap[id] = c;
    }
  } catch {
    /* edge table missing */
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
      <p className="text-xs text-pact-dim/70 max-w-3xl mb-6">
        Scenarios are <em>not</em> claims: they are <strong>containers</strong> for predicates plus
        the applies_when edges that connect them to verified topics and government-sourced
        legislation. Browse below or call{" "}
        <code className="text-pact-cyan">POST /api/scenarios/match</code> to resolve programmatically.
      </p>

      {scenarios.length > 0 && <ClusterSummaryStrip scenarios={scenarios} />}

      {scenarios.length === 0 ? (
        <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center">
          <p className="text-pact-dim">
            No scenarios are seeded in this environment yet. Seed scripts live in
            <code className="text-pact-cyan mx-1">sites/source/scripts/seed_scenarios_*.py</code>.
          </p>
        </div>
      ) : (
        <ScenariosExplorer scenarios={scenarios} counts={countsMap} />
      )}
    </div>
  );
}
