"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

type SearchResult = {
  productId: string;
  name: string;
  brand: string | null;
  cheapestPriceCents: number | null;
  retailerCount: number;
  category: string | null;
};

function formatAud(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function GrocerySearchInner() {
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(qParam);
  const [debounced, setDebounced] = useState(qParam.trim());
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 320);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setQuery(qParam);
    setDebounced(qParam.trim());
  }, [qParam]);

  const runSearch = useCallback(async (q: string) => {
    if (!q) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/market/products/search?query=${encodeURIComponent(q)}&limit=24`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Search failed");
      }
      setResults(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runSearch(debounced);
  }, [debounced, runSearch]);

  return (
    <div className="bg-gray-950 text-gray-100 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/"
          className="text-gray-500 hover:text-cyan-400 text-sm mb-6 inline-block transition-colors"
        >
          &larr; Back to PACT
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Grocery search
          </h1>
          <p className="mt-3 text-gray-400 max-w-2xl leading-relaxed">
            Search the PACT product catalogue. Cheapest observed price and retailer coverage update
            as agents post new observations.
          </p>
        </header>

        <div className="mb-8">
          <label htmlFor="grocery-q" className="sr-only">
            Search products
          </label>
          <input
            id="grocery-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. milk, bread, laundry powder…"
            className="w-full rounded-xl border border-gray-800 bg-gray-900/80 px-4 py-3 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            autoComplete="off"
          />
        </div>

        {error ? (
          <p className="text-rose-400 text-sm mb-4" role="alert">
            {error}
          </p>
        ) : null}

        {loading && debounced ? (
          <p className="text-gray-500 text-sm mb-6">Searching…</p>
        ) : null}

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map((p) => (
            <li key={p.productId}>
              <Link
                href={`/grocery?q=${encodeURIComponent(p.name)}`}
                className="block rounded-xl border border-gray-800 bg-gray-900/50 p-5 h-full hover:border-cyan-500/30 hover:bg-gray-900 transition-colors"
              >
                <div className="flex justify-between gap-3 items-start">
                  <div>
                    <h2 className="font-semibold text-white leading-snug">{p.name}</h2>
                    {p.brand ? (
                      <p className="text-sm text-gray-500 mt-1">{p.brand}</p>
                    ) : null}
                    {p.category ? (
                      <p className="text-xs text-gray-600 mt-2">{p.category}</p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-semibold text-emerald-400 tabular-nums">
                      {formatAud(p.cheapestPriceCents)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {p.retailerCount} retailer{p.retailerCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-cyan-500/80 mt-4">Tap to search this product name</p>
              </Link>
            </li>
          ))}
        </ul>

        {!loading && debounced && results.length === 0 && !error ? (
          <p className="text-gray-500 text-sm">No products matched that query.</p>
        ) : null}

        {!debounced ? (
          <p className="text-gray-600 text-sm">Type at least one word to search.</p>
        ) : null}
      </div>
    </div>
  );
}

export default function GroceryPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-gray-950 text-gray-100 min-h-screen flex items-center justify-center">
          <p className="text-gray-500">Loading…</p>
        </div>
      }
    >
      <GrocerySearchInner />
    </Suspense>
  );
}
