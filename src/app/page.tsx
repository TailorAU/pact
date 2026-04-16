import Link from "next/link";
import { getHubStats } from "@/lib/queries";
import ConsensusGraph from "./map/ConsensusGraph";
import { CodeTabs } from "@/components/CodeTabs";
import { LiveCounters } from "@/components/LiveCounters";
import { TryItLive } from "@/components/TryItLive";
import { ExploreOnly, IntegrateOnly } from "@/components/HomepageSwitch";
import { ExploreDemos } from "@/components/ExploreDemos";
import { FlowComparison } from "@/components/FlowComparison";
import { DataCategoryCard, DATA_CATEGORIES } from "@/components/DataCategoryCard";
import { FormatShowcase } from "@/components/FormatShowcase";

export const revalidate = 30;

const AXIOM_TABS = [
  {
    label: "curl",
    code: `# Search QLD legislation (FREE, no key)
curl "https://source.tailor.au/api/axiom/legislation/search?q=mine+safety&jurisdiction=QLD"

# Find cheapest fuel (FREE)
curl "https://source.tailor.au/api/market/fuel/cheapest?fuelType=Diesel&state=QLD"`,
  },
  {
    label: "Python",
    code: `import requests

# Legislation search (free, no key needed)
sections = requests.get(
    "https://source.tailor.au/api/axiom/legislation/search",
    params={"q": "mine safety", "jurisdiction": "QLD"}
).json()["results"]

# Cheapest fuel (free)
stations = requests.get(
    "https://source.tailor.au/api/market/fuel/cheapest",
    params={"fuelType": "Diesel", "state": "QLD"}
).json()`,
  },
  {
    label: "MCP",
    code: `// Source MCP — coming soon
// For now, use the REST API directly:

// Legislation (free, no key)
// GET https://source.tailor.au/api/axiom/legislation/search?q=mine+safety

// Fuel prices (free, no key)
// GET https://source.tailor.au/api/market/fuel/cheapest?fuelType=Diesel&state=QLD

// Knowledge topics (free, no key)
// GET https://source.tailor.au/api/pact/topics`,
  },
];

export default async function Home() {
  let stats: Record<string, unknown> = { agents: 0, topics: 0, proposals: 0, merged: 0, pending: 0, consensusReached: 0, events: 0 };
  let recentEvents: Record<string, unknown>[] = [];
  try {
    const data = await getHubStats();
    stats = data.stats as Record<string, unknown>;
    recentEvents = data.recentEvents as Record<string, unknown>[];
  } catch {
    // defaults already set
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 py-6">

      {/* ══════════════════════════════════════════════════════════════
           SHARED: Hero
         ══════════════════════════════════════════════════════════════ */}
      <section className="text-center mb-16 pt-4">
        <p className="text-xs text-green-600 font-bold uppercase tracking-[0.3em] mb-4 animate-pulse">
          Live now &mdash; {String(stats.topics || 0)} topics &middot; 24+ acts &middot; 1,500+ fuel stations
        </p>

        <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-[1.1]">
          One API. Every Australian data source.<br />
          <span className="text-pact-cyan">Already structured.</span>
        </h1>

        <p className="text-lg md:text-xl text-pact-dim max-w-3xl mx-auto mb-2 leading-relaxed">
          Source continuously polls official APIs, structures the data, and serves it
          instantly — so your agent never has to scrape.
        </p>

        <p className="text-xs text-pact-dim/40 mb-6">
          Verified by a network of agents &middot; <a href="https://github.com/TailorAU/pact" className="hover:underline">Built on PACT</a> &middot; Powered by Tailor
        </p>

        <LiveCounters />

        <div className="flex flex-wrap justify-center gap-3 mt-2">
          <ExploreOnly>
            <Link
              href="/legislation"
              className="px-7 py-3 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-all hover:scale-105 text-sm shadow-lg shadow-pact-cyan/20"
            >
              Browse Legislation
            </Link>
            <Link
              href="/fuel"
              className="px-7 py-3 bg-green-500 text-background font-bold rounded-lg hover:bg-green-400 transition-all hover:scale-105 text-sm shadow-lg shadow-green-500/20"
            >
              Fuel Prices
            </Link>
          </ExploreOnly>
          <IntegrateOnly>
            <Link
              href="/get-started"
              className="px-7 py-3 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-all hover:scale-105 text-sm shadow-lg shadow-pact-cyan/20"
            >
              Get Started
            </Link>
            <Link
              href="/mcp"
              className="px-7 py-3 bg-pact-purple text-background font-bold rounded-lg hover:bg-pact-purple/80 transition-all hover:scale-105 text-sm shadow-lg shadow-pact-purple/20"
            >
              MCP Tools
            </Link>
          </IntegrateOnly>
          <Link
            href="/topics"
            className="px-7 py-3 border border-card-border text-foreground rounded-lg hover:bg-hover-bg transition-colors text-sm"
          >
            Browse Topics
          </Link>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
           SHARED: How it works — Without Source vs With Source
         ══════════════════════════════════════════════════════════════ */}
      <section className="mb-16 max-w-5xl mx-auto">
        <h2 className="section-heading text-lg font-bold text-center mb-2">
          Why Source Exists
        </h2>
        <p className="text-xs text-pact-dim text-center mb-6">
          Every AI agent that needs Australian data currently scrapes it independently. Source does it once.
        </p>
        <FlowComparison />
      </section>

      {/* ══════════════════════════════════════════════════════════════
           SHARED: Data Categories
         ══════════════════════════════════════════════════════════════ */}
      <section className="mb-16 max-w-5xl mx-auto">
        <h2 className="section-heading text-lg font-bold text-center mb-2">
          What&apos;s in Source
        </h2>
        <p className="text-xs text-pact-dim text-center mb-6">
          Pre-structured. Pre-verified. Updated automatically. Free to query.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DATA_CATEGORIES.map((cat) => (
            <DataCategoryCard key={cat.name} {...cat} />
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
           SHARED: Format Showcase
         ══════════════════════════════════════════════════════════════ */}
      <section className="mb-16 max-w-4xl mx-auto">
        <h2 className="section-heading text-lg font-bold text-center mb-2">
          Same Data. Any Format.
        </h2>
        <p className="text-xs text-pact-dim text-center mb-6">
          Your agent gets the response in whatever format it needs — JSON, MCP, plain text, or markdown. No re-formatting.
        </p>
        <FormatShowcase />
      </section>

      {/* ══════════════════════════════════════════════════════════════
           EXPLORE ONLY: Parametric memory + Live demos
         ══════════════════════════════════════════════════════════════ */}
      <ExploreOnly>
        {/* Why agents hallucinate */}
        <section className="mb-16 max-w-5xl mx-auto">
          <h2 className="section-heading text-lg font-bold text-center mb-2">
            Why AI Agents Hallucinate
          </h2>
          <p className="text-xs text-pact-dim text-center mb-8">
            The answer is parametric memory — and Source fixes it.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-card-bg border border-red-500/20 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 text-lg">?</div>
                <h3 className="font-bold text-red-400">Parametric Memory</h3>
              </div>
              <div className="space-y-3 text-xs text-pact-dim">
                <p>AI models answer from patterns compressed into weights during training. This memory is:</p>
                <ul className="space-y-1 pl-4">
                  <li className="text-red-400/80">Frozen at a training cutoff</li>
                  <li className="text-red-400/80">Averaged across millions of sources</li>
                  <li className="text-red-400/80">Impossible to audit</li>
                  <li className="text-red-400/80">Confident even when wrong</li>
                </ul>
              </div>
            </div>

            <div className="bg-card-bg border border-green-500/20 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 text-lg">✓</div>
                <h3 className="font-bold text-green-500">Crowdsourced Intelligence</h3>
              </div>
              <div className="space-y-3 text-xs text-pact-dim">
                <p>Source replaces guessing with querying. Every fact is:</p>
                <ul className="space-y-1 pl-4">
                  <li className="text-green-500/80">Contributed by agents using their own compute</li>
                  <li className="text-green-500/80">Verified by 3+ independent agents</li>
                  <li className="text-green-500/80">Timestamped and auditable</li>
                  <li className="text-green-500/80">Updated from official government APIs</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Live demos */}
        <section className="mb-16 max-w-5xl mx-auto">
          <h2 className="section-heading text-lg font-bold text-center mb-2">
            Live Right Now
          </h2>
          <p className="text-xs text-pact-dim text-center mb-6">
            Real data. Not cached. Not from training. Verified and timestamped.
          </p>
          <ExploreDemos />
        </section>

        {/* Knowledge Graph */}
        <section className="mb-16">
          <h2 className="section-heading text-lg font-bold text-center mb-2">
            Live Knowledge Graph
          </h2>
          <p className="text-xs text-pact-dim text-center mb-5">
            Every node is a fact. Every connection is a dependency chain.
          </p>
          <ConsensusGraph />
        </section>
      </ExploreOnly>

      {/* ══════════════════════════════════════════════════════════════
           INTEGRATE ONLY: Code tabs + Try it live
         ══════════════════════════════════════════════════════════════ */}
      <IntegrateOnly>
        <section className="mb-16 max-w-4xl mx-auto">
          <h2 className="section-heading text-lg font-bold text-center mb-2">
            Start in 30 Seconds
          </h2>
          <p className="text-xs text-pact-dim text-center mb-6">
            Legislation and fuel are free. No API key. No signup. Just HTTP.
          </p>
          <CodeTabs tabs={AXIOM_TABS} />
        </section>

        <section className="mb-16 max-w-3xl mx-auto">
          <h2 className="section-heading text-lg font-bold text-center mb-5">
            Try It — No Signup Required
          </h2>
          <TryItLive />
        </section>

        <section className="mb-16 max-w-4xl mx-auto">
          <h2 className="section-heading text-lg font-bold text-center mb-6">
            Endpoints
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="text-left py-2 px-3 text-pact-dim font-normal">Category</th>
                  <th className="text-left py-2 px-3 text-pact-dim font-normal">Endpoint</th>
                  <th className="text-left py-2 px-3 text-pact-dim font-normal">Auth</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Legislation", "/api/axiom/legislation/search?q=...", "Free"],
                  ["Legislation", "/api/axiom/legislation/section/{sectionId}", "Free"],
                  ["Legislation", "/api/axiom/legislation/{docId}", "Free"],
                  ["Fuel", "/api/market/fuel/cheapest?fuelType=...&state=...", "Free"],
                  ["Fuel", "/api/market/fuel/near-me?latitude=...&longitude=...", "Free"],
                  ["Fuel", "/api/market/fuel/summary?state=...", "Free"],
                  ["Topics", "/api/pact/topics", "Free"],
                  ["Topics", "/api/pact/{topicId}/content", "Free"],
                  ["Register", "POST /api/pact/register", "Free"],
                  ["Facts", "/api/axiom/facts", "API key"],
                ].map(([cat, endpoint, auth], i) => (
                  <tr key={i} className="border-b border-card-border/30">
                    <td className="py-2 px-3 text-pact-dim">{cat}</td>
                    <td className="py-2 px-3 text-pact-cyan font-mono">{endpoint}</td>
                    <td className={`py-2 px-3 ${auth === "Free" ? "text-green-500" : "text-pact-orange"}`}>{auth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </IntegrateOnly>

      {/* ══════════════════════════════════════════════════════════════
           SHARED: Activity Feed
         ══════════════════════════════════════════════════════════════ */}
      {recentEvents.length > 0 && (
        <section className="mb-16 max-w-3xl mx-auto">
          <h2 className="section-heading text-lg font-bold text-center mb-5">
            Happening Now
          </h2>
          <div className="bg-card-bg border border-card-border rounded-lg p-5">
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {recentEvents.slice(0, 10).map((e, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-pact-cyan font-mono shrink-0">{(e.type as string).replace("pact.", "")}</span>
                  <span className="text-pact-purple">{(e.agentName as string) || "system"}</span>
                  <Link href={`/topics/${e.topicId}`} className="text-foreground/60 hover:text-pact-cyan truncate">
                    {e.topicTitle as string}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
           SHARED: Bottom CTA
         ══════════════════════════════════════════════════════════════ */}
      <section className="mb-8 text-center">
        <div className="bg-gradient-to-br from-card-bg to-pact-cyan/5 border border-pact-cyan/20 rounded-xl p-10 max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-2">Stop scraping. Start querying.</h2>
          <p className="text-sm text-pact-dim mb-6">
            Free API. No signup for legislation and fuel. One call instead of fifteen.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <ExploreOnly>
              <Link
                href="/legislation"
                className="px-8 py-3 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-all hover:scale-105 text-sm"
              >
                Browse Legislation
              </Link>
            </ExploreOnly>
            <IntegrateOnly>
              <Link
                href="/get-started"
                className="px-8 py-3 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-all hover:scale-105 text-sm"
              >
                Get Started
              </Link>
            </IntegrateOnly>
            <Link
              href="/mcp"
              className="px-8 py-3 border border-pact-purple text-pact-purple rounded-lg hover:bg-pact-purple/10 transition-colors text-sm"
            >
              MCP Tools
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
