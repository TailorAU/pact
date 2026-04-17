"use client";
/**
 * #1160 Round 5 — Client-side scenario explorer.
 *
 * Server page (`page.tsx`) loads every scenario once and hands it here. We
 * keep the server render SEO-friendly (grouped list of all scenarios) and
 * overlay a cluster/jurisdiction filter layer on the client. No query-string
 * URL sync yet — kept intentionally simple so the filter survives page reload
 * via localStorage but doesn't pollute the public scenario URLs.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Scenario } from "@/lib/scenarios/types";

type EdgeCount = { legislation: number; topics: number };

type ClusterKey =
  | "defence"
  | "critical-minerals"
  | "asx"
  | "mining-safety"
  | "procurement"
  | "privacy"
  | "whs"
  | "aml-ctf"
  | "us-inbound";

const CLUSTERS: { key: ClusterKey; label: string }[] = [
  { key: "defence", label: "Defence" },
  { key: "critical-minerals", label: "Critical minerals" },
  { key: "asx", label: "ASX" },
  { key: "mining-safety", label: "Mining safety" },
  { key: "procurement", label: "Procurement" },
  { key: "privacy", label: "Privacy" },
  { key: "whs", label: "WHS" },
  { key: "aml-ctf", label: "AML / CTF" },
  { key: "us-inbound", label: "US-inbound" },
];

function scenarioClusters(s: Scenario): ClusterKey[] {
  const out = new Set<ClusterKey>();
  for (const t of s.tags) {
    const k = t as ClusterKey;
    if (CLUSTERS.find((c) => c.key === k)) out.add(k);
  }
  return Array.from(out);
}

function summarisePredicates(p: Record<string, unknown>): string {
  const entries = Object.entries(p).slice(0, 3);
  if (entries.length === 0) return "No predicates defined";
  return entries
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k} \u2208 ${v.slice(0, 3).join(" | ")}${v.length > 3 ? "\u2026" : ""}`;
      if (typeof v === "object" && v !== null) return `${k}: \u2026`;
      return `${k} = ${String(v)}`;
    })
    .join(" \u00b7 ");
}

interface Props {
  scenarios: Scenario[];
  counts: Record<string, EdgeCount>;
}

export function ScenariosExplorer({ scenarios, counts }: Props) {
  const [selected, setSelected] = useState<Set<ClusterKey>>(
    () => new Set(CLUSTERS.map((c) => c.key)),
  );

  const clusterCounts = useMemo(() => {
    const m = new Map<ClusterKey, number>(CLUSTERS.map((c) => [c.key, 0]));
    for (const s of scenarios) {
      for (const k of scenarioClusters(s)) {
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [scenarios]);

  const filtered = useMemo(() => {
    if (selected.size === CLUSTERS.length) return scenarios;
    return scenarios.filter((s) => {
      const c = scenarioClusters(s);
      if (c.length === 0) return false;
      return c.some((k) => selected.has(k));
    });
  }, [scenarios, selected]);

  const allOn = selected.size === CLUSTERS.length;

  const groups = useMemo(() => {
    const m = new Map<string, Scenario[]>();
    for (const s of filtered) {
      const key = s.industry ?? "Uncategorised";
      (m.get(key) ?? m.set(key, []).get(key)!).push(s);
    }
    return Array.from(m.entries());
  }, [filtered]);

  function toggle(k: ClusterKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase text-pact-dim/70 tracking-[0.18em] mr-1">Clusters</span>
        {CLUSTERS.map((c) => {
          const on = selected.has(c.key);
          const count = clusterCounts.get(c.key) ?? 0;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                on
                  ? "border-pact-orange/60 text-pact-orange bg-pact-orange/5"
                  : "border-card-border text-pact-dim/70 hover:border-card-border"
              }`}
              aria-pressed={on}
            >
              {c.label} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
        {!allOn && (
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded border border-card-border text-pact-dim hover:text-pact-cyan"
            onClick={() => setSelected(new Set(CLUSTERS.map((c) => c.key)))}
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center">
          <p className="text-pact-dim">No scenarios match your filters.</p>
          <button
            type="button"
            onClick={() => setSelected(new Set(CLUSTERS.map((c) => c.key)))}
            className="mt-3 text-xs text-pact-cyan hover:underline"
          >
            Reset filters
          </button>
        </div>
      )}

      <div className="space-y-10">
        {groups.map(([industry, items]) => (
          <section key={industry}>
            <h2 className="text-xs uppercase tracking-[0.2em] text-pact-dim/70 mb-3 font-bold">
              {industry}{" "}
              <span className="text-pact-dim/50 normal-case">
                \u00b7 {items.length} scenario{items.length === 1 ? "" : "s"}
              </span>
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {items.map((s) => {
                const c = counts[s.id];
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.jurisdiction && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-400/30 text-slate-300 uppercase font-bold">
                            {s.jurisdiction}
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-pact-orange/30 text-pact-orange uppercase font-bold">
                          scenario
                        </span>
                      </div>
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
                    {s.sourceRef && (
                      <div
                        className="text-[11px] text-pact-cyan/80 mb-2 truncate"
                        title={s.sourceRef}
                      >
                        Source: {s.sourceRef}
                      </div>
                    )}
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
    </>
  );
}

export function ClusterSummaryStrip({ scenarios }: { scenarios: Scenario[] }) {
  const counts = useMemo(() => {
    const m = new Map<ClusterKey, number>(CLUSTERS.map((c) => [c.key, 0]));
    for (const s of scenarios) {
      for (const k of scenarioClusters(s)) {
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [scenarios]);
  return (
    <div className="mb-6 text-xs text-pact-dim/80 flex flex-wrap gap-x-3 gap-y-1">
      {CLUSTERS.map((c) => {
        const n = counts.get(c.key) ?? 0;
        if (n === 0) return null;
        return (
          <span key={c.key}>
            <span className="text-pact-cyan">{n}</span> {c.label}
          </span>
        );
      })}
    </div>
  );
}
