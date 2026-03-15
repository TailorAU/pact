"use client";

import { useState } from "react";

const EXAMPLE_QUERIES = [
  { label: "GDPR", q: "GDPR" },
  { label: "FDA", q: "FDA" },
  { label: "Privacy", q: "privacy" },
  { label: "ISO", q: "ISO" },
  { label: "Boiling point", q: "boiling" },
  { label: "Thermodynamics", q: "entropy" },
];

export function TryItLive() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyUsed, setKeyUsed] = useState("");

  async function search(q: string) {
    const searchQ = q || query;
    if (!searchQ.trim()) return;
    setLoading(true);
    setError("");
    setResults(null);

    try {
      // Get a throwaway key
      let key = keyUsed;
      if (!key) {
        const keyResp = await fetch("/api/axiom/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerName: "live-demo" }),
        });
        const keyData = await keyResp.json();
        key = keyData.secret;
        setKeyUsed(key);
      }

      const resp = await fetch(`/api/axiom/facts?q=${encodeURIComponent(searchQ)}&limit=5`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = await resp.json();
      if (data.facts) {
        setResults(data.facts);
      } else {
        setError(data.error || "No results");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const tierColor: Record<string, string> = {
    axiom: "text-pact-cyan bg-pact-cyan/10 border-pact-cyan/30",
    empirical: "text-green-400 bg-green-400/10 border-green-400/30",
    institutional: "text-pact-purple bg-pact-purple/10 border-pact-purple/30",
    interpretive: "text-pact-orange bg-pact-orange/10 border-pact-orange/30",
    conjecture: "text-pact-dim bg-pact-dim/10 border-pact-dim/30",
  };

  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Live API — Try it now</span>
      </div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Search verified facts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search("")}
          className="flex-1 bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:border-pact-cyan focus:outline-none"
        />
        <button
          onClick={() => search("")}
          disabled={loading}
          className="px-4 py-2 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-colors text-sm disabled:opacity-50"
        >
          {loading ? "..." : "Search"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {EXAMPLE_QUERIES.map((eq) => (
          <button
            key={eq.q}
            onClick={() => { setQuery(eq.q); search(eq.q); }}
            className="px-2.5 py-1 text-[10px] border border-card-border rounded-full text-pact-dim hover:text-pact-cyan hover:border-pact-cyan/40 transition-colors"
          >
            {eq.label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {results && results.length === 0 && (
        <p className="text-pact-dim text-xs">No facts match that query yet. <span className="text-pact-cyan">Be the first to propose one.</span></p>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {results.map((f, i) => (
            <div key={i} className="bg-background/50 rounded-lg p-3 border border-card-border/50">
              <div className="flex items-start gap-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${tierColor[(f.tier as string)] || tierColor.conjecture}`}>
                  {(f.tier as string).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground leading-snug">{f.title as string}</p>
                  {f.jurisdiction ? (
                    <span className="text-[9px] text-pact-purple mt-0.5 inline-block">{f.jurisdiction as string}</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-pact-dim/50 text-right pt-1">
            Results from the Axiom API — each fact verified by multi-agent consensus
          </p>
        </div>
      )}

      {!results && !error && (
        <div className="text-center py-6">
          <p className="text-xs text-pact-dim/40">Click a tag or search to query the live knowledge graph</p>
        </div>
      )}
    </div>
  );
}
