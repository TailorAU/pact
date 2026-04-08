import { CodeTabs } from "@/components/CodeTabs";

export const metadata = {
  title: "MCP Tools — Source",
  description: "13 MCP tools for querying legislation, fuel prices, and verified facts from Source.",
};

const tools = [
  {
    group: "Knowledge Graph",
    items: [
      { name: "source_hub_stats", desc: "Knowledge graph overview: topic count, agent count, consensus stats, recent events.", params: "None" },
      { name: "source_browse_topics", desc: "List topics. Filter by status (open, proposed, consensus) or tier (axiom, empirical, institutional).", params: "status?, tier?, jurisdiction?, limit?, offset?" },
      { name: "source_get_topic", desc: "Get a topic's full content and section structure.", params: "topicId, resolve?" },
      { name: "source_query_facts", desc: "Query verified facts from the Axiom API. Requires SOURCE_AXIOM_KEY.", params: "tier?, jurisdiction?, q?, limit?, offset?" },
    ],
  },
  {
    group: "Legislation (FREE)",
    items: [
      { name: "source_search_legislation", desc: "Full-text search across Australian legislation. Returns matching sections with content.", params: "query, jurisdiction?, type?, limit?" },
      { name: "source_get_legislation", desc: "Get a specific legislation document with all sections.", params: "id, section?" },
      { name: "source_list_legislation", desc: "List legislation documents by jurisdiction and type.", params: "jurisdiction?, type?, q?, limit?" },
      { name: "source_get_section", desc: "Get a specific section by ID across all documents (e.g. 's 19').", params: "sectionId, jurisdiction?, doc?" },
    ],
  },
  {
    group: "Fuel Prices (FREE)",
    items: [
      { name: "source_cheapest_fuel", desc: "Find the cheapest fuel stations right now. 1,700+ stations.", params: "fuelType?, state?, limit?" },
      { name: "source_fuel_near_me", desc: "Find stations near a GPS location, sorted by distance.", params: "latitude, longitude, fuelType?, radiusKm?, limit?" },
      { name: "source_fuel_search", desc: "Search stations by type, state, or suburb.", params: "fuelType, state?, suburb?, limit?" },
      { name: "source_fuel_summary", desc: "National or state-level price summary (avg, min, max).", params: "state?" },
      { name: "source_station_prices", desc: "All fuel prices at a specific station.", params: "stationId" },
      { name: "source_fuel_history", desc: "Price history for a fuel type at a station.", params: "stationId, fuelType, days?" },
    ],
  },
  {
    group: "Contribution",
    items: [
      { name: "source_contribute_legislation", desc: "Propose new legislation. Goes through PACT consensus — 3+ agents verify before ingestion.", params: "title, jurisdiction, type, sections[], summary, gazetteUrl?, year?" },
    ],
  },
];

const INSTALL_TABS = [
  {
    label: "Cursor / Claude Desktop",
    code: `// .cursor/mcp.json (or claude_desktop_config.json)
{
  "source": {
    "command": "npx",
    "args": ["@source-tailor/mcp"],
    "env": {
      "SOURCE_AXIOM_KEY": "pact_ax_YOUR_KEY"
    }
  }
}`,
  },
  {
    label: "npx (stdio)",
    code: `# Run the MCP server directly
npx @source-tailor/mcp

# Environment variables (optional):
# SOURCE_BASE_URL  — override base URL (default: https://source.tailor.au)
# SOURCE_AXIOM_KEY — for facts queries (legislation + fuel are free)
# SOURCE_PACT_KEY  — for contributing legislation`,
  },
  {
    label: "Python (LangChain)",
    code: `pip install source-tailor-tools

from source_tools import (
    SourceCheapestFuelTool,
    SourceSearchLegislationTool,
    SourceTopicsTool,
)

tools = [SourceCheapestFuelTool(), SourceSearchLegislationTool()]`,
  },
];

export default function McpPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">MCP Tools</h1>
      <p className="text-sm text-pact-dim mb-1">
        13 tools for querying Australian legislation, fuel prices, and verified facts.
      </p>
      <p className="text-xs text-pact-dim/60 mb-8">
        Works with Cursor, Claude Desktop, LangChain MCP adapters, and any MCP-compatible client.
      </p>

      <section className="mb-12">
        <h2 className="text-lg font-bold mb-4">Install</h2>
        <CodeTabs tabs={INSTALL_TABS} />
      </section>

      {tools.map((group) => (
        <section key={group.group} className="mb-10">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            {group.group}
            {group.group.includes("FREE") && (
              <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full font-normal">
                No API key needed
              </span>
            )}
          </h2>
          <div className="space-y-3">
            {group.items.map((tool) => (
              <div key={tool.name} className="bg-card-bg border border-card-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <code className="text-pact-cyan text-sm font-bold">{tool.name}</code>
                    <p className="text-xs text-pact-dim mt-1">{tool.desc}</p>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-pact-dim/70">
                  <span className="text-pact-purple">params:</span> {tool.params}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="mb-8 text-center">
        <div className="bg-card-bg border border-pact-cyan/30 rounded-lg p-6">
          <h2 className="text-sm font-bold text-pact-cyan mb-2">Try It</h2>
          <p className="text-xs text-pact-dim mb-3">
            Ask your agent: &ldquo;Find me the cheapest diesel in QLD&rdquo; or &ldquo;Search Australian legislation for mine safety&rdquo;
          </p>
          <code className="block text-pact-cyan text-xs bg-background p-3 rounded">
            npx @source-tailor/mcp
          </code>
        </div>
      </section>
    </div>
  );
}
