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
    <div className="bg-background text-foreground min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/"
          className="text-pact-dim hover:text-foreground font-mono text-xs uppercase tracking-wider mb-6 inline-block transition-colors"
        >
          &larr; Back to PACT
        </Link>

        <header className="mb-10">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-pact-dim mb-1">
            PACT MARKET &middot; INTELLIGENCE CAPACITY &amp; VERIFIED PRICE FEEDS
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Cheap, safe, secure, reliable tokens &amp; market feeds.
          </h1>
          <p className="mt-3 text-pact-dim text-base max-w-3xl leading-relaxed">
            PACT clears qualified intelligence capacity at the lowest{" "}
            <span className="font-mono text-xs text-foreground">$/1M</span> token rate &mdash; grounded in{" "}
            <Link href="/map" className="text-foreground font-semibold underline underline-offset-2">
              Space (/map)
            </Link>{" "}
            so agents never burn tokens re-proving public law &mdash; alongside live multi-agent verified Australian fuel and retail price feeds.
          </p>
        </header>

        {/* Intelligence Capacity Clearing Strip (Firm / Floating / Reserve) */}
        <section className="mb-10 border border-foreground bg-background p-6" aria-label="Token Capacity Classes">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4 pb-3 border-b border-card-border">
            <div>
              <h2 className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-foreground">
                Intelligence Capacity Clearing &middot; Qualified $/1M Token Classes
              </h2>
              <p className="text-xs text-pact-dim mt-0.5">
                Every workload specifies its security, jurisdiction, and latency constraints; PACT clears across three capacity classes.
              </p>
            </div>
            <span className="font-mono text-xs font-bold border border-foreground px-2.5 py-1">
              METRIC: $/1M QUALIFIED TOKENS
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-card-border bg-card-bg p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-pact-dim mb-1">
                01 &middot; FIRM CAPACITY
              </div>
              <div className="font-bold text-base text-foreground mb-1">
                Dedicated Sovereign &amp; Cell-Pinned
              </div>
              <p className="text-xs text-pact-dim leading-relaxed">
                Reserved Australian-hosted capacity for interactive 2D <strong className="text-foreground">Fabric</strong> sessions and <strong className="text-foreground">Neutral Seam Leads</strong> with deterministic SLA and zero queue delay.
              </p>
            </div>

            <div className="border border-foreground bg-background p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-foreground font-bold mb-1">
                02 &middot; FLOATING CAPACITY
              </div>
              <div className="font-bold text-base text-foreground mb-1">
                Spot-Cleared Qualified Inference
              </div>
              <p className="text-xs text-pact-dim leading-relaxed">
                Real-time routing to the lowest-cost qualified provider meeting the caller&apos;s data-residency and epistemic-warrant policy.
              </p>
            </div>

            <div className="border border-card-border bg-card-bg p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-pact-dim mb-1">
                03 &middot; RESERVE CAPACITY
              </div>
              <div className="font-bold text-base text-foreground mb-1">
                Batch &amp; Off-Peak Space Verification
              </div>
              <p className="text-xs text-pact-dim leading-relaxed">
                Interruptible batch execution for statutory ingestion, citation verification, and <strong className="text-foreground">Space</strong> (<span className="font-mono text-[11px]">X, Y, Z, T</span>) consensus sweeps at floor token rates.
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <p className="text-foreground font-mono text-xs border border-foreground p-3 mb-6" role="alert">
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

        <section className="mb-12 border border-card-border bg-card-bg p-6 sm:p-8">
          <h2 className="text-xl font-bold text-foreground mb-4">How PACT market verification works</h2>
          <div className="text-pact-dim space-y-4 leading-relaxed max-w-3xl text-sm">
            <p>
              PACT applies the{" "}
              <strong className="text-foreground">Protocol for Agent Consensus and Truth</strong>{" "}
              to live market data: multiple agents ingest public price feeds, reconcile
              conflicts, and surface the strongest consensus view &mdash; so downstream apps get prices
              they can reason about, not a single scraper&apos;s snapshot.
            </p>
            <p>
              Fuel rows aggregate station-level observations; grocery search ranks products by
              textual match and attaches the latest multi-retailer price ladder where
              observations exist.
            </p>
          </div>
        </section>

        <section className="flex flex-col sm:flex-row gap-4 font-mono">
          <Link
            href="/fuel"
            className="flex-1 border border-foreground bg-foreground text-background px-6 py-5 text-center hover:opacity-85 transition-opacity"
          >
            <span className="block font-bold uppercase tracking-wider text-sm">Fuel prices &amp; map</span>
            <span className="block text-xs text-background/80 mt-1">OpenStreetMap + cheapest station list</span>
          </Link>
          <Link
            href="/grocery"
            className="flex-1 border border-foreground bg-background text-foreground px-6 py-5 text-center hover:bg-hover-bg transition-colors"
          >
            <span className="block font-bold uppercase tracking-wider text-sm">Grocery search</span>
            <span className="block text-xs text-pact-dim mt-1">Find products and compare multi-retailer offers</span>
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
      className={`border p-5 ${
        emphasize
          ? "border-foreground bg-background"
          : "border-card-border bg-card-bg"
      }`}
    >
      <p className="text-pact-dim font-mono text-[11px] uppercase tracking-wider">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-foreground mt-2 tabular-nums">{value}</p>
      <p className="text-pact-dim text-xs mt-2">{hint}</p>
    </div>
  );
}
