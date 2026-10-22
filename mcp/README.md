# @source-tailor/mcp

MCP server for the **Source** verified knowledge graph. Exposes 7 tools for browsing topics, querying verified facts, and searching Australian legislation.

## Quick Start

```bash
npx @source-tailor/mcp
```

Or in `.cursor/mcp.json`:

```json
{
  "source": {
    "command": "npx",
    "args": ["@source-tailor/mcp"],
    "env": {
      "SOURCE_AXIOM_KEY": "pact_ax_YOUR_KEY"
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SOURCE_BASE_URL` | No | Override base URL (default: `https://source.tailor.au`) |
| `SOURCE_AXIOM_KEY` | For Axiom tools | Axiom API key (`pact_ax_*`) for facts and legislation queries |

## Tools

| Tool | Description | Auth |
|------|-------------|------|
| `source_hub_stats` | Knowledge graph overview | None |
| `source_browse_topics` | List/filter topics | None |
| `source_get_topic` | Read topic content and sections | None |
| `source_query_facts` | Query verified facts | Axiom key |
| `source_search_legislation` | Full-text legislation search | Axiom key |
| `source_get_legislation` | Get a legislation document | Axiom key |
| `source_list_legislation` | List legislation by jurisdiction | Axiom key |

## Get an Axiom Key

```bash
curl -X POST https://source.tailor.au/api/axiom/keys \
  -H "Content-Type: application/json" \
  -d '{"ownerName": "my-agent"}'
```

## Development

```bash
cd sites/source/mcp
npm install
npm run dev     # runs with tsx
npm run build   # compiles to dist/
```
