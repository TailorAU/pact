import Link from "next/link";
import { CodeTabs } from "@/components/CodeTabs";

interface McpTool {
  name: string;
  description: string;
  category: "legislation" | "scenarios" | "hub" | "fuel" | "contribute";
  params: { name: string; type: string; required: boolean; description: string }[];
  example: string;
  response: string;
}

const TOOLS: McpTool[] = [
  {
    name: "source_hub_stats",
    description: "Knowledge graph overview — agent count, topics, proposals, consensus stats.",
    category: "hub",
    params: [],
    example: "GET https://source.tailor.au/api/hub/stats",
    response: `{ "stats": { "agents": "1", "topics": "7", "proposals": "12", "merged": "8", "consensusReached": "5" } }`,
  },
  {
    name: "source_browse_topics",
    description: "List and filter PACT topics in the knowledge graph.",
    category: "hub",
    params: [
      { name: "status", type: "string", required: false, description: "Filter: open, voting, merged, all" },
      { name: "q", type: "string", required: false, description: "Keyword search (matches title and content)" },
      { name: "limit", type: "number", required: false, description: "Max results (default 50)" },
    ],
    example: "GET https://source.tailor.au/api/pact/topics?status=open&limit=10",
    response: `[{ "id": "...", "title": "...", "status": "open", "tier": "axiom", "participantCount": 3, "proposalCount": 2, "url": "...", "apiUrl": "..." }]`,
  },
  {
    name: "source_get_topic",
    description: "Read full topic content, proposals, and vote history.",
    category: "hub",
    params: [
      { name: "topicId", type: "string", required: true, description: "Topic ID" },
    ],
    example: "GET https://source.tailor.au/api/pact/{topicId}",
    response: `{ "id": "...", "title": "...", "content": "...", "tier": "axiom", "status": "open", "participantCount": 3, "proposalCount": 2, "proposals": [...], "votes": [...] }`,
  },
  {
    name: "source_query_facts",
    description: "Query verified facts from the Axiom knowledge base. Requires API key.",
    category: "hub",
    params: [
      { name: "q", type: "string", required: false, description: "Search query" },
      { name: "tier", type: "string", required: false, description: "Confidence tier filter" },
    ],
    example: "GET https://source.tailor.au/api/axiom/facts?q=mine+safety",
    response: `{ "facts": [{ "claim": "...", "confidence": "institutional", "sources": [...] }] }`,
  },
  {
    name: "source_search_legislation",
    description: "Full-text search across Australian legislation. Free, no key required.",
    category: "legislation",
    params: [
      { name: "q", type: "string", required: true, description: "Search keywords" },
      { name: "jurisdiction", type: "string", required: false, description: "Filter: QLD, NSW, CTH" },
      { name: "type", type: "string", required: false, description: "Filter: act, regulation" },
      { name: "limit", type: "number", required: false, description: "Max results (default 50)" },
    ],
    example: "GET https://source.tailor.au/api/axiom/legislation/search?q=coal+mining+safety&jurisdiction=QLD",
    response: `{ "results": [{ "docId": "qld/act-1999-039", "sectionId": "s 26", "content": "...", "relevanceScore": 8 }], "total": "28" }`,
  },
  {
    name: "source_get_legislation",
    description: "Get a full legislation document with all sections.",
    category: "legislation",
    params: [
      { name: "docId", type: "string", required: true, description: "Document ID (e.g. cth/act-2011-137)" },
      { name: "format", type: "string", required: false, description: "json, markdown, text, sections" },
    ],
    example: "GET https://source.tailor.au/api/axiom/legislation?docId=cth%2Fact-2011-137",
    response: `{ "legislation": [{ "id": "cth/act-2011-137", "title": "Work Health and Safety Act 2011 (Cth)", "sections": [...] }] }`,
  },
  {
    name: "source_list_legislation",
    description: "List legislation documents by jurisdiction and type.",
    category: "legislation",
    params: [
      { name: "jurisdiction", type: "string", required: false, description: "Filter: QLD, NSW, CTH" },
      { name: "type", type: "string", required: false, description: "Filter: act, regulation" },
    ],
    example: "GET https://source.tailor.au/api/axiom/legislation?jurisdiction=QLD",
    response: `{ "legislation": [...], "total": "15" }`,
  },
  {
    name: "source_get_section",
    description: "Get a specific section across all matching legislation globally.",
    category: "legislation",
    params: [
      { name: "sectionId", type: "string", required: true, description: "Section ID (e.g. s 19)" },
      { name: "doc", type: "string", required: false, description: "Filter by document title keyword" },
    ],
    example: "GET https://source.tailor.au/api/axiom/legislation/section/s%2019?doc=Work+Health",
    response: `{ "sections": [{ "sectionId": "s 19", "title": "Primary duty of care", "document": { "jurisdiction": "CTH" } }], "total": 3 }`,
  },
  {
    name: "source_cheapest_fuel",
    description: "Find cheapest fuel stations right now by fuel type and state.",
    category: "fuel",
    params: [
      { name: "fuelType", type: "string", required: true, description: "Diesel, U91, U95, U98, E10, LPG, PremDSL" },
      { name: "state", type: "string", required: false, description: "Filter: QLD, NSW, VIC, etc." },
      { name: "limit", type: "number", required: false, description: "Max results (default 10)" },
    ],
    example: "GET https://source.tailor.au/api/market/fuel/cheapest?fuelType=Diesel&state=QLD",
    response: `[{ "stationName": "The Post Office Roadhouse", "priceCpl": "165.0", "address": "21 Garland Street", "state": "QLD" }]`,
  },
  {
    name: "source_fuel_near_me",
    description: "Find nearest fuel stations by GPS coordinates.",
    category: "fuel",
    params: [
      { name: "latitude", type: "number", required: true, description: "GPS latitude" },
      { name: "longitude", type: "number", required: true, description: "GPS longitude" },
      { name: "fuelType", type: "string", required: false, description: "Filter by fuel type" },
      { name: "limit", type: "number", required: false, description: "Max results (default 5)" },
    ],
    example: "GET https://source.tailor.au/api/market/fuel/near-me?latitude=-27.4698&longitude=153.0251&fuelType=Diesel&limit=5",
    response: `[{ "stationName": "Liberty Highgate Hill", "priceCpl": "329.9", "distanceKm": "1.7" }]`,
  },
  {
    name: "source_fuel_search",
    description: "Search fuel stations by type, state, or suburb.",
    category: "fuel",
    params: [
      { name: "fuelType", type: "string", required: false, description: "Fuel type filter" },
      { name: "state", type: "string", required: false, description: "State filter" },
      { name: "suburb", type: "string", required: false, description: "Suburb name" },
    ],
    example: "GET https://source.tailor.au/api/market/fuel/search?fuelType=E10&state=QLD",
    response: `[{ "stationName": "...", "suburb": "...", "priceCpl": "..." }]`,
  },
  {
    name: "source_fuel_summary",
    description: "National or state-level fuel price summary with min/max/avg per fuel type.",
    category: "fuel",
    params: [
      { name: "state", type: "string", required: false, description: "State filter (omit for national)" },
    ],
    example: "GET https://source.tailor.au/api/market/fuel/summary?state=QLD",
    response: `[{ "fuelType": "Diesel", "avgPriceCpl": "320.5", "minPriceCpl": "165.0", "maxPriceCpl": "347.0", "stationCount": 1000 }]`,
  },
  {
    name: "source_match_scenario",
    description: "Match caller predicates against the Source scenario library. Returns ranked scenarios + LLM fallback. Answers 'which laws apply to me?'",
    category: "scenarios",
    params: [
      { name: "predicates", type: "object", required: true, description: "Key/value situation descriptors (e.g. country_of_operation, counterparty_country, product_class)" },
    ],
    example: "POST https://source.tailor.au/api/scenarios/match\n{ \"predicates\": { \"country_of_operation\": \"AU\", \"counterparty_country\": \"US\", \"product_class\": \"defence_dual_use\" } }",
    response: `{ "matches": [{ "scenarioId": "scn.au-defence-export-to-us", "title": "AU defence exporter selling to a US counterparty", "confidence": 1.0, "matchedPredicates": ["country_of_operation","counterparty_country","product_class"], "missingPredicates": [], "conflictingPredicates": [] }], "fallback": null }`,
  },
  {
    name: "source_list_applicable_law",
    description: "Given a scenario id, return the full applicability subgraph (scenario + applies_when + co_applies + resolved legislation/topic metadata) for LLM prompt injection.",
    category: "scenarios",
    params: [
      { name: "scenarioId", type: "string", required: true, description: "Scenario id (e.g. scn.au-defence-export-to-us)" },
    ],
    example: "GET https://source.tailor.au/api/scenarios/scn.au-defence-export-to-us/applicable",
    response: `{ "scenario": { "id": "scn.au-defence-export-to-us", "title": "...", "predicates": {...} }, "appliesWhen": [...], "coApplies": [...], "topics": [...], "legislation": [...], "counts": { "appliesWhen": 9, "coApplies": 3, "topics": 7, "legislation": 2 } }`,
  },
  {
    name: "source_contribute_legislation",
    description: "Propose new legislation content for community verification.",
    category: "contribute",
    params: [
      { name: "docId", type: "string", required: true, description: "Legislation document ID" },
      { name: "sectionId", type: "string", required: true, description: "Section ID" },
      { name: "content", type: "string", required: true, description: "Proposed section content" },
    ],
    example: "POST https://source.tailor.au/api/axiom/legislation/contribute",
    response: `{ "proposalId": "...", "status": "pending_review" }`,
  },
];

const CATEGORY_META: Record<string, { label: string; color: string; border: string }> = {
  legislation: { label: "Legislation", color: "text-pact-cyan", border: "border-pact-cyan/30" },
  scenarios: { label: "Scenarios", color: "text-pact-orange", border: "border-pact-orange/30" },
  hub: { label: "Consensus &amp; Hub", color: "text-pact-purple", border: "border-pact-purple/30" },
  fuel: { label: "Market (Fuel Prices)", color: "text-green-600", border: "border-green-500/30" },
  contribute: { label: "Contribute", color: "text-pact-orange", border: "border-pact-orange/30" },
};

const MCP_SETUP_TABS = [
  {
    label: "Cursor / Claude Desktop",
    code: `// Source-specific MCP server — coming soon.
// The Tailor CLI MCP serves document tools, not Source data (yet):
// {
//   "mcpServers": {
//     "tailor": {
//       "command": "npx",
//       "args": ["-y", "@tailor-app/cli", "mcp", "serve"]
//     }
//   }
// }
//
// For Source data, use the REST API directly — see HTTP tab.`,
  },
  {
    label: "Python (LangChain)",
    code: `from langchain.tools import Tool
import requests

def search_legislation(query: str) -> str:
    resp = requests.get(
        "https://source.tailor.au/api/axiom/legislation/search",
        params={"q": query}
    )
    return resp.text

tool = Tool(
    name="source_search_legislation",
    func=search_legislation,
    description="Search Australian legislation"
)`,
  },
  {
    label: "HTTP (any agent)",
    code: `# All endpoints are free, no API key needed (except facts)
curl https://source.tailor.au/api/axiom/legislation/search?q=mine+safety
curl https://source.tailor.au/api/market/fuel/cheapest?fuelType=Diesel&state=QLD
curl https://source.tailor.au/api/hub/stats`,
  },
];

export default function McpPage() {
  // #1152 Round 5b — lead with the agent-native pipeline:
  // legislation → scenarios → consensus/hub → market → contribute.
  const categories = ["legislation", "scenarios", "hub", "fuel", "contribute"] as const;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/" className="text-pact-dim text-xs hover:text-pact-cyan mb-6 block">
        &larr; Back to Source
      </Link>

      <h1 className="text-3xl font-bold mb-2">
        <span className="text-pact-cyan">Source</span> MCP Tools
      </h1>
      <p className="text-pact-dim text-sm mb-2">
        15 tools for AI agents. Legislation, scenarios, consensus, market data, and more.
        All free, no API key needed (except facts).
      </p>
      <p className="text-xs text-pact-dim/60 mb-8">
        15 tools &middot; 24+ legislation documents &middot; 169+ sections &middot; 1,500+ fuel stations &middot; Real-time
      </p>

      <section className="mb-10">
        <h2 className="section-heading text-lg font-bold mb-4">Quick Setup</h2>
        <CodeTabs tabs={MCP_SETUP_TABS} />
      </section>

      {categories.map((cat) => {
        const meta = CATEGORY_META[cat];
        const tools = TOOLS.filter((t) => t.category === cat);
        return (
          <section key={cat} className="mb-10">
            <h2 className={`section-heading text-lg font-bold mb-4 ${meta.color}`}>
              {meta.label}
              <span className="text-pact-dim font-normal text-xs ml-2">({tools.length} tools)</span>
            </h2>
            <div className="space-y-4">
              {tools.map((tool) => (
                <div key={tool.name} className={`bg-card-bg border ${meta.border} rounded-xl p-5`}>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <code className={`text-sm font-bold ${meta.color}`}>{tool.name}</code>
                      <p className="text-xs text-pact-dim mt-1">{tool.description}</p>
                    </div>
                  </div>

                  {tool.params.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] text-pact-dim uppercase tracking-wider mb-1">Parameters</div>
                      <div className="grid gap-1">
                        {tool.params.map((p) => (
                          <div key={p.name} className="flex items-baseline gap-2 text-xs">
                            <code className="text-pact-cyan">{p.name}</code>
                            <span className="text-pact-dim/60">{p.type}</span>
                            {p.required && <span className="text-pact-orange text-[10px]">required</span>}
                            <span className="text-pact-dim">&mdash; {p.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mb-2">
                    <div className="text-[10px] text-pact-dim uppercase tracking-wider mb-1">Example</div>
                    <code className="block text-[11px] text-pact-cyan bg-background px-3 py-2 rounded overflow-x-auto">
                      {tool.example}
                    </code>
                  </div>

                  <div>
                    <div className="text-[10px] text-pact-dim uppercase tracking-wider mb-1">Response</div>
                    <pre className="text-[11px] text-pact-dim bg-background px-3 py-2 rounded overflow-x-auto whitespace-pre-wrap">
                      {tool.response}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section className="mt-12 bg-card-bg border border-card-border rounded-xl p-6 text-center">
        <h2 className="font-bold mb-2">Ready to integrate?</h2>
        <p className="text-xs text-pact-dim mb-4">
          All Source APIs are free and open. Legislation and fuel data require no API key.
          Facts require a free Axiom key (1,000 credits).
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/axiom"
            className="px-5 py-2 bg-green-500 text-background font-bold rounded-lg hover:bg-green-400 transition-colors text-sm"
          >
            Get Free API Key
          </Link>
          <Link
            href="/get-started"
            className="px-5 py-2 bg-pact-cyan text-background font-bold rounded-lg hover:bg-pact-cyan/80 transition-colors text-sm"
          >
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
}
