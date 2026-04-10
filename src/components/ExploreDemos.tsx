"use client";
import { LiveDemoCard } from "./LiveDemoCard";

interface FuelStation {
  stationName: string;
  brandName: string | null;
  address: string | null;
  priceCpl: string;
  state: string;
}

interface LegSection {
  docTitle: string;
  sectionId: string;
  sectionTitle: string | null;
  content: string;
  jurisdiction: string;
}

function FuelResults(data: Record<string, unknown> | Record<string, unknown>[]) {
  const stations = (Array.isArray(data) ? data : []) as unknown as FuelStation[];
  if (stations.length === 0) return <div className="text-xs text-pact-dim">No results</div>;
  return (
    <div className="space-y-2">
      {stations.slice(0, 3).map((s, i) => (
        <div key={i} className="flex items-center justify-between text-sm">
          <div>
            <span className="text-foreground font-medium">{s.stationName}</span>
            <span className="text-pact-dim text-xs ml-2">{s.brandName}</span>
          </div>
          <span className="text-green-500 font-bold">{Number(s.priceCpl).toFixed(1)} c/L</span>
        </div>
      ))}
    </div>
  );
}

function LegislationResults(data: Record<string, unknown> | Record<string, unknown>[]) {
  const d = data as unknown as { results?: LegSection[] };
  const results = d?.results ?? [];
  if (results.length === 0) return <div className="text-xs text-pact-dim">No results</div>;
  return (
    <div className="space-y-2">
      {results.slice(0, 3).map((r, i) => (
        <div key={i} className="text-sm">
          <div className="flex items-center gap-2">
            <span className="text-pact-cyan font-mono text-xs">{r.sectionId}</span>
            <span className="text-foreground font-medium">{r.sectionTitle || r.docTitle}</span>
          </div>
          <p className="text-pact-dim text-xs mt-0.5 line-clamp-2">{r.content?.slice(0, 150)}...</p>
        </div>
      ))}
    </div>
  );
}

export function ExploreDemos() {
  return (
    <div className="grid md:grid-cols-2 gap-5">
      <LiveDemoCard
        title="Live Fuel Prices"
        question="Where's the cheapest fuel in QLD?"
        apiUrl="https://source.tailor.au/api/market/fuel/cheapest?fuelType=U91&state=QLD&limit=3"
        renderResult={FuelResults}
        cta="Your agent can do this. Just ask: 'Find me the cheapest U91 in QLD'"
        accent="green-500"
      />
      <LiveDemoCard
        title="Verified Legislation"
        question="What does the mining safety law say?"
        apiUrl="https://source.tailor.au/api/axiom/legislation/search?q=coal+mining+safety&jurisdiction=QLD&limit=3"
        renderResult={LegislationResults}
        cta="Verified statutory text — not LLM memory."
        accent="pact-cyan"
      />
    </div>
  );
}
