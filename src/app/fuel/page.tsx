"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FuelStationMarker } from "@/components/fuel-map";

const MapComponent = dynamic(() => import("@/components/fuel-map"), { ssr: false });

const FUEL_TYPES = ["U91", "U95", "U98", "E10", "Diesel", "PremDSL", "LPG"] as const;

type FuelSummaryRow = {
  fuelType: string;
  avgPriceCpl: number;
  minPriceCpl: number;
  maxPriceCpl: number;
  stationCount: number;
};

export default function FuelPage() {
  const [fuelType, setFuelType] = useState<string>("U91");
  const [stations, setStations] = useState<FuelStationMarker[]>([]);
  const [summary, setSummary] = useState<FuelSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (ft: string) => {
    setLoading(true);
    setError(null);
    try {
      const [cheapestRes, summaryRes] = await Promise.all([
        fetch(`/api/market/fuel/cheapest?fuelType=${encodeURIComponent(ft)}&limit=50`),
        fetch("/api/market/fuel/summary"),
      ]);
      if (!cheapestRes.ok) throw new Error("Could not load fuel prices");
      if (!summaryRes.ok) throw new Error("Could not load summary");
      const cheapestJson = (await cheapestRes.json()) as FuelStationMarker[];
      const summaryJson = (await summaryRes.json()) as FuelSummaryRow[];
      setStations(Array.isArray(cheapestJson) ? cheapestJson : []);
      setSummary(Array.isArray(summaryJson) ? summaryJson : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(fuelType);
  }, [fuelType, loadData]);

  const rowForFuel = useMemo(
    () => summary.find((r) => r.fuelType === fuelType),
    [summary, fuelType]
  );

  const totalStations = useMemo(() => {
    if (summary.length === 0) return null;
    return Math.max(...summary.map((r) => Number(r.stationCount)));
  }, [summary]);

  const sortedTable = useMemo(() => {
    return [...stations].sort((a, b) => Number(a.priceCpl) - Number(b.priceCpl));
  }, [stations]);

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/"
          className="text-pact-dim hover:text-pact-cyan text-sm mb-6 inline-block transition-colors"
        >
          &larr; Back to Source
        </Link>

        <header className="mb-8 sm:mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            QLD Fuel Prices
          </h1>
          <p className="mt-3 text-pact-dim text-base sm:text-lg max-w-2xl leading-relaxed">
            {totalStations != null
              ? `Live prices from ${totalStations.toLocaleString()}+ stations.`
              : "Live fuel prices."}{" "}
            Updated every 30 minutes from the QLD Government API.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 mb-8">
          {FUEL_TYPES.map((ft) => (
            <button
              key={ft}
              type="button"
              onClick={() => setFuelType(ft)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                fuelType === ft
                  ? "bg-pact-cyan/20 text-pact-cyan ring-1 ring-pact-cyan/50"
                  : "bg-card-bg text-pact-dim hover:bg-hover-bg hover:text-foreground ring-1 ring-card-border"
              }`}
            >
              {ft}
            </button>
          ))}
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border border-card-border bg-card-bg p-4 sm:p-5">
            <p className="text-pact-dim text-xs uppercase tracking-wide">Average</p>
            <p className="text-2xl font-semibold text-foreground mt-1 tabular-nums">
              {rowForFuel != null ? `${Number(rowForFuel.avgPriceCpl).toFixed(1)} c/L` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-card-border bg-card-bg p-4 sm:p-5">
            <p className="text-pact-dim text-xs uppercase tracking-wide">Minimum</p>
            <p className="text-2xl font-semibold text-green-500 mt-1 tabular-nums">
              {rowForFuel != null ? `${Number(rowForFuel.minPriceCpl).toFixed(1)} c/L` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-card-border bg-card-bg p-4 sm:p-5">
            <p className="text-pact-dim text-xs uppercase tracking-wide">Maximum</p>
            <p className="text-2xl font-semibold text-pact-red mt-1 tabular-nums">
              {rowForFuel != null ? `${Number(rowForFuel.maxPriceCpl).toFixed(1)} c/L` : "—"}
            </p>
          </div>
        </section>

        {error ? (
          <p className="text-pact-red text-sm mb-4" role="alert">
            {error}
          </p>
        ) : null}

        <section className="mb-10">
          {loading ? (
            <div className="h-[min(70vh,560px)] min-h-[320px] rounded-xl border border-card-border bg-card-bg animate-pulse" />
          ) : (
            <MapComponent stations={stations} />
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Cheapest {fuelType} stations
            {rowForFuel != null && (
              <span className="text-pact-dim text-sm font-normal ml-2">
                ({Number(rowForFuel.stationCount).toLocaleString()} reporting)
              </span>
            )}
          </h2>
          <div className="overflow-x-auto rounded-xl border border-card-border">
            <table className="w-full text-sm text-left">
              <thead className="bg-card-bg text-pact-dim uppercase text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Station</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Brand</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {sortedTable.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-pact-dim">
                      No stations found for {fuelType}.
                    </td>
                  </tr>
                ) : (
                  sortedTable.map((s) => (
                    <tr key={s.stationId} className="hover:bg-hover-bg">
                      <td className="px-4 py-3 font-mono text-green-600 tabular-nums">
                        {Number(s.priceCpl).toFixed(1)} c/L
                      </td>
                      <td className="px-4 py-3 text-foreground">{s.stationName}</td>
                      <td className="px-4 py-3 text-pact-dim hidden sm:table-cell">
                        {s.brandName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-pact-dim/70 hidden md:table-cell">
                        {[s.suburb, s.state].filter(Boolean).join(", ") || s.address || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
