"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type FuelSummaryRow = {
  fuelType: string;
  avgPriceCpl: number;
  minPriceCpl: number;
  maxPriceCpl: number;
  stationCount: number;
};

type CatalogStats = {
  productCount: number;
  retailerCount: number;
};

export default function MarketPage() {
  const [summary, setSummary] = useState<FuelSummaryRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sRes = await fetch("/api/market/fuel/summary");
        if (!sRes.ok) throw new Error("Could not load fuel summary");
        const sData = (await sRes.json()) as FuelSummaryRow[];
        if (!cancelled) setSummary(Array.isArray(sData) ? sData : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      }
      try {
        const cRes = await fetch("/api/market/catalog/stats");
        if (cRes.ok) {
          const cData = (await cRes.json()) as CatalogStats;
          if (!cancelled) setCatalog(cData);
        }
      } catch {
        /* catalog is optional for dashboard */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fuelStationsTracked = summary.reduce((m, r) => Math.max(m, r.stationCount), 0);

  return (
    <div className="bg-gray-950 text-gray-100 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/"
          className="text-gray-500 hover:text-cyan-400 text-sm mb-6 inline-block transition-colors"
        >
          &larr; Back to Source
        </Link>

        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Market intelligence
          </h1>
          <p className="mt-3 text-gray-400 text-lg max-w-2xl leading-relaxed">
            Aggregated Australian retail and fuel pricing, refreshed on a regular cadence and
            cross-checked by Source agents.
          </p>
        </header>

        {error ? (
          <p className="text-rose-400 text-sm mb-6" role="alert">
            {error}
          </p>
        ) : null}

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <StatCard
            label="Fuel stations tracked"
            value={loading ? "…" : fuelStationsTracked.toLocaleString()}
            hint="Peak coverage by fuel type (24h)"
          />
          <StatCard
            label="Products tracked"
            value={
              loading
                ? "…"
                : catalog != null
                  ? catalog.productCount.toLocaleString()
                  : "—"
            }
            hint="Grocery catalogue"
          />
          <StatCard
            label="Retailers monitored"
            value={
              loading
                ? "…"
                : catalog != null
                  ? catalog.retailerCount.toLocaleString()
                  : "—"
            }
            hint="Across price observations"
          />
          <StatCard
            label="Update cadence"
            value="30 min"
            hint="Fuel price refresh target"
            emphasize
          />
        </section>

        <section className="mb-12 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-white mb-4">How it works</h2>
          <div className="text-gray-400 space-y-4 leading-relaxed max-w-3xl">
            <p>
              Source applies the{" "}
              <span className="text-cyan-400/90">PACT</span> (Protocol for Agent Consensus and
              Truth) model to market data: multiple agents ingest public price feeds, reconcile
              conflicts, and surface the strongest consensus view — so downstream apps get prices
              they can reason about, not a single scraper&apos;s snapshot.
            </p>
            <p>
              Fuel rows aggregate station-level observations; grocery search ranks products by
              textual match and attaches the latest multi-retailer price ladder where
              observations exist.
            </p>
          </div>
        </section>

        <section className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/fuel"
            className="flex-1 rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-6 py-5 text-center hover:bg-cyan-950/35 transition-colors ring-1 ring-cyan-500/20"
          >
            <span className="block text-white font-semibold">Fuel prices &amp; map</span>
            <span className="block text-sm text-gray-500 mt-1">OpenStreetMap + cheapest list</span>
          </Link>
          <Link
            href="/grocery"
            className="flex-1 rounded-xl border border-gray-800 bg-gray-900/50 px-6 py-5 text-center hover:bg-gray-900 transition-colors"
          >
            <span className="block text-white font-semibold">Grocery search</span>
            <span className="block text-sm text-gray-500 mt-1">Find products and compare offers</span>
          </Link>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        emphasize
          ? "border-cyan-500/25 bg-cyan-950/15"
          : "border-gray-800 bg-gray-900/50"
      }`}
    >
      <p className="text-gray-500 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-white mt-2 tabular-nums">{value}</p>
      <p className="text-gray-600 text-xs mt-2">{hint}</p>
    </div>
  );
}
