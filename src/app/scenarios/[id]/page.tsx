/**
 * #1152 Round 5c — /scenarios/[id] detail page ("the money shot").
 *
 * Given a scenario id, render:
 *   1. A predicate card ("applies when country = AU AND product_class = …").
 *   2. Applicable legislation list (from scenario_applies_when -> legislation_docs).
 *   3. Applicable topics list (from scenario_applies_when -> topics).
 *   4. Co-applies relationships scoped to this scenario.
 *   5. A "Try in Fabric" CTA — coming soon until #1151 panel lands.
 *
 * The lookup is deliberately server-side so an anonymous visitor can deep
 * link to a scenario page and see the full subgraph without a client-side
 * fetch round-trip.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import {
  getScenario,
  getAppliesWhen,
  getCoApplies,
} from "@/lib/scenarios/queries";
import { SpotCheckCta } from "./spot-check-cta";

export const revalidate = 60;

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const scenario = await getScenario(id).catch(() => null);
  if (!scenario) return { title: "Scenario — PACT" };
  return {
    title: `${scenario.title} — PACT scenarios`,
    description:
      scenario.description ||
      "Predicate-driven applicability scenario served by PACT.",
  };
}

type LegDetail = {
  id: string;
  jurisdiction: string | null;
  doc_type: string | null;
  title: string;
  short_title: string | null;
  year: number | null;
};

type TopicDetail = {
  id: string;
  title: string;
  tier: string;
  status: string;
};

export default async function ScenarioDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const qs = (await searchParams) ?? {};
  const agentMode = qs.agent !== undefined;
  const scenario = await getScenario(id).catch(() => null);
  if (!scenario) notFound();

  const [applies, coApplies] = await Promise.all([
    getAppliesWhen(scenario.id).catch(() => []),
    getCoApplies(scenario.id).catch(() => []),
  ]);

  const legIds = Array.from(
    new Set(applies.map((a) => a.legislationId).filter((x): x is string => !!x)),
  );
  const topicIds = Array.from(
    new Set(applies.map((a) => a.topicId).filter((x): x is string => !!x)),
  );

  // Resolve legislation + topic details for the applicability lists and the
  // co-applies section. Falls back gracefully if the schema is missing.
  const db = await getDb();
  let legs: LegDetail[] = [];
  let topics: TopicDetail[] = [];
  if (legIds.length > 0) {
    // drizzle/libsql doesn't support IN (?) array binding — inline the ids
    // defensively (they're uuids, but still escape).
    const quoted = legIds.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
    try {
      const r = await db.execute(
        `SELECT id, jurisdiction, doc_type, title, short_title, year
         FROM legislation_docs WHERE id IN (${quoted})`,
      );
      legs = r.rows as unknown as LegDetail[];
    } catch { /* schema missing */ }
  }
  // Build the full co-apply id set (could include legislation ids that are
  // not in `applies` because co_applies can span outside this scenario's
  // own applies_when set).
  const coApplyLegIds = new Set<string>();
  const coApplyTopicIds = new Set<string>();
  for (const c of coApplies) {
    if (c.leftLegislationId) coApplyLegIds.add(c.leftLegislationId);
    if (c.rightLegislationId) coApplyLegIds.add(c.rightLegislationId);
    if (c.leftTopicId) coApplyTopicIds.add(c.leftTopicId);
    if (c.rightTopicId) coApplyTopicIds.add(c.rightTopicId);
  }
  const allLegIds = Array.from(new Set([...legIds, ...coApplyLegIds]));
  if (allLegIds.length > legIds.length) {
    const quoted = allLegIds.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
    try {
      const r = await db.execute(
        `SELECT id, jurisdiction, doc_type, title, short_title, year
         FROM legislation_docs WHERE id IN (${quoted})`,
      );
      legs = r.rows as unknown as LegDetail[];
    } catch { /* already-populated */ }
  }
  const allTopicIds = Array.from(new Set([...topicIds, ...coApplyTopicIds]));
  if (allTopicIds.length > 0) {
    const quoted = allTopicIds.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
    try {
      const r = await db.execute(
        `SELECT id, title, tier, status FROM topics WHERE id IN (${quoted})`,
      );
      topics = r.rows as unknown as TopicDetail[];
    } catch { /* schema missing */ }
  }

  const legById = new Map(legs.map((l) => [l.id, l]));
  const topicById = new Map(topics.map((t) => [t.id, t]));

  const predicateEntries = Object.entries(scenario.predicates);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/scenarios" className="text-pact-dim text-xs hover:text-pact-cyan mb-6 block">
        &larr; All scenarios
      </Link>

      <div className="flex flex-wrap items-start gap-3 mb-3">
        <h1 className="text-3xl font-bold flex-1 min-w-0">{scenario.title}</h1>
        <span className="text-[10px] px-2 py-1 rounded border border-pact-orange/40 text-pact-orange uppercase font-bold">
          scenario
        </span>
        {scenario.jurisdiction && (
          <span className="text-[10px] px-2 py-1 rounded border border-slate-400/30 text-slate-300 uppercase font-bold">
            {scenario.jurisdiction}
          </span>
        )}
        {scenario.industry && (
          <span className="text-[10px] px-2 py-1 rounded border border-card-border text-pact-dim uppercase">
            {scenario.industry}
          </span>
        )}
      </div>

      {scenario.sourceRef && (
        <p className="text-sm text-pact-cyan/90 mb-3">
          <span className="text-pact-dim/70 mr-2 text-xs uppercase tracking-wider">Source</span>
          {scenario.sourceRef}
        </p>
      )}

      {scenario.description && (
        <p className="text-pact-dim max-w-3xl mb-8">{scenario.description}</p>
      )}

      {/* Predicates card */}
      <section className="bg-card-bg border border-pact-orange/30 rounded-xl p-6 mb-8">
        <h2 className="font-bold text-sm mb-3 text-pact-orange">Applies when</h2>
        {predicateEntries.length === 0 ? (
          <p className="text-pact-dim text-xs">
            No structured predicates; this scenario is matched by description + tags only.
          </p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {predicateEntries.map(([k, v]) => (
              <li
                key={k}
                className="bg-background/50 border border-card-border/60 rounded px-3 py-2 flex items-baseline gap-2"
              >
                <code className="text-pact-cyan text-xs">{k}</code>
                <span className="text-pact-dim text-xs">=</span>
                <span className="text-foreground/90 text-xs font-mono truncate" title={JSON.stringify(v)}>
                  {Array.isArray(v)
                    ? v.map(String).join(" | ")
                    : typeof v === "object" && v !== null
                    ? JSON.stringify(v)
                    : String(v)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Applicable legislation */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-3">
          Applicable legislation{" "}
          <span className="text-xs text-pact-dim/70 font-normal">
            ({legIds.length} {legIds.length === 1 ? "item" : "items"})
          </span>
        </h2>
        {legIds.length === 0 ? (
          <p className="text-pact-dim text-sm">No legislation directly attached to this scenario.</p>
        ) : (
          <ul className="divide-y divide-card-border/40 bg-card-bg border border-card-border rounded-xl overflow-hidden">
            {applies
              .filter((a) => a.legislationId)
              .map((a) => {
                const leg = legById.get(a.legislationId!);
                const displayTitle = leg?.short_title || leg?.title || a.legislationId;
                return (
                  <li key={a.id} className="px-4 py-3 flex items-baseline gap-3 flex-wrap">
                    <Link
                      href={`/legislation/${encodeURIComponent(a.legislationId!)}`}
                      className="text-sm text-foreground/90 hover:text-pact-cyan transition-colors flex-1 min-w-[240px]"
                    >
                      {displayTitle}
                    </Link>
                    {leg?.jurisdiction && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-400/30 text-slate-300 uppercase">
                        {leg.jurisdiction}
                      </span>
                    )}
                    {leg?.year != null && (
                      <span className="text-[10px] text-pact-dim/70">{leg.year}</span>
                    )}
                    {a.note && (
                      <span className="text-[11px] text-pact-dim/80 w-full">{a.note}</span>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {/* Applicable topics */}
      {topicIds.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3">
            Applicable topics{" "}
            <span className="text-xs text-pact-dim/70 font-normal">
              ({topicIds.length} {topicIds.length === 1 ? "claim" : "claims"})
            </span>
          </h2>
          <ul className="divide-y divide-card-border/40 bg-card-bg border border-card-border rounded-xl overflow-hidden">
            {applies
              .filter((a) => a.topicId)
              .map((a) => {
                const t = topicById.get(a.topicId!);
                return (
                  <li key={a.id} className="px-4 py-3 flex items-baseline gap-3 flex-wrap">
                    <Link
                      href={`/topics/${encodeURIComponent(a.topicId!)}`}
                      className="text-sm text-foreground/90 hover:text-pact-cyan transition-colors flex-1 min-w-[240px]"
                    >
                      {t?.title ?? a.topicId}
                    </Link>
                    {t?.tier && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-400/30 text-amber-400 uppercase">
                        {t.tier}
                      </span>
                    )}
                    {a.note && (
                      <span className="text-[11px] text-pact-dim/80 w-full">{a.note}</span>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* Co-applies — scoped to this scenario */}
      {coApplies.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3">
            Co-applies within this scenario{" "}
            <span className="text-xs text-pact-dim/70 font-normal">
              ({coApplies.length} relationship{coApplies.length === 1 ? "" : "s"})
            </span>
          </h2>
          <p className="text-xs text-pact-dim/70 max-w-3xl mb-3">
            Rules don&rsquo;t globally co-apply &mdash; they co-apply <em>when</em> the scenario is
            true. The pairs below reinforce each other under the{" "}
            <span className="text-pact-orange">{scenario.title}</span> predicates.
          </p>
          <ul className="divide-y divide-card-border/40 bg-card-bg border border-card-border rounded-xl overflow-hidden">
            {coApplies.map((c) => {
              const leftTitle = c.leftLegislationId
                ? legById.get(c.leftLegislationId)?.short_title ||
                  legById.get(c.leftLegislationId)?.title ||
                  c.leftLegislationId
                : c.leftTopicId
                ? topicById.get(c.leftTopicId)?.title || c.leftTopicId
                : "?";
              const rightTitle = c.rightLegislationId
                ? legById.get(c.rightLegislationId)?.short_title ||
                  legById.get(c.rightLegislationId)?.title ||
                  c.rightLegislationId
                : c.rightTopicId
                ? topicById.get(c.rightTopicId)?.title || c.rightTopicId
                : "?";
              return (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <div className="flex items-baseline flex-wrap gap-2">
                    <span className="text-slate-300">{leftTitle}</span>
                    <span className="text-pact-dim">&harr;</span>
                    <span className="text-slate-300">{rightTitle}</span>
                    <span className="ml-auto text-[10px] uppercase text-indigo-300 font-semibold">
                      {c.relationship}
                    </span>
                  </div>
                  {c.note && (
                    <p className="text-[12px] text-pact-dim/80 mt-1">{c.note}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {agentMode && (
        <SpotCheckCta scenarioId={scenario.id} appliesWhen={applies} />
      )}

      {/* Try in Fabric — coming soon until #1151 panel lands. */}
      <section className="bg-card-bg border border-pact-cyan/30 rounded-xl p-6 text-center">
        <h2 className="font-bold text-sm text-pact-cyan mb-2">Try this in Tailor Fabric</h2>
        <p className="text-xs text-pact-dim max-w-2xl mx-auto mb-4">
          Tailor Fabric can pin this applicability subgraph into any document or meeting
          context &mdash; outline generation, pipeline construction, and compliance review will
          all draw from the legislation and topics above.
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Link
            href="https://tailor.au/request-access"
            className="px-5 py-2 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-colors text-sm"
          >
            Request Fabric access
          </Link>
          <code className="text-xs text-pact-dim/70 bg-background px-2 py-2 rounded border border-card-border">
            POST /api/scenarios/match
          </code>
        </div>
      </section>
    </div>
  );
}
