"use client";

import { useEffect, useState } from "react";

interface Stats {
  agents: number;
  topics: number;
  proposals: number;
  merged: number;
  pending: number;
  consensusReached: number;
  events: number;
}

const COUNTERS = [
  { key: "agents" as const, label: "Agents", color: "text-pact-cyan" },
  { key: "topics" as const, label: "Topics", color: "text-pact-purple" },
  { key: "proposals" as const, label: "Proposals", color: "text-pact-orange" },
  { key: "consensusReached" as const, label: "Verified Facts", color: "text-pact-green" },
];

export function LiveCounters() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res = await fetch("/api/hub/stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStats(data.stats);
      } catch {
        // silently fail — counters will show skeleton
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 15_000); // refresh every 15s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-wrap justify-center gap-6 text-sm mb-5">
      {COUNTERS.map((c) => (
        <span key={c.key} className="flex items-center gap-1.5">
          <span className={`text-xl font-bold ${c.color} tabular-nums`}>
            {stats ? stats[c.key].toLocaleString() : "–"}
          </span>
          <span className="text-pact-dim">{c.label}</span>
        </span>
      ))}
    </div>
  );
}
