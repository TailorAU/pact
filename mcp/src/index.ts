#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.SOURCE_BASE_URL || "https://source.tailor.au";
const AXIOM_KEY = process.env.SOURCE_AXIOM_KEY || "";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

async function sourceGet(path: string, axiomAuth = false): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (axiomAuth && AXIOM_KEY) {
    headers["Authorization"] = `Bearer ${AXIOM_KEY}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "Source — Verified Knowledge Graph",
    version: "0.1.0",
  });

  server.tool(
    "source_hub_stats",
    "Get Source knowledge graph overview: topic count, agent count, consensus stats, recent events.",
    {},
    async () => {
      try {
        return jsonResult(await sourceGet("/api/hub/stats"));
      } catch (e) { return errorResult(e); }
    }
  );

  server.tool(
    "source_browse_topics",
    "List topics in the Source knowledge graph. Filter by status (open, proposed, consensus, stable, locked) or tier (axiom, empirical, institutional, interpretive, conjecture).",
    {
      status: z.string().optional().describe("Filter by topic status"),
      tier: z.string().optional().describe("Filter by knowledge tier"),
      jurisdiction: z.string().optional().describe("Filter by jurisdiction (e.g. AU, AU-QLD)"),
      limit: z.number().optional().describe("Max results (default 50, max 200)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    async ({ status, tier, jurisdiction, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (tier) params.set("tier", tier);
        if (jurisdiction) params.set("jurisdiction", jurisdiction);
        if (limit) params.set("limit", String(limit));
        if (offset) params.set("offset", String(offset));
        const qs = params.toString();
        return jsonResult(await sourceGet(`/api/pact/topics${qs ? `?${qs}` : ""}`));
      } catch (e) { return errorResult(e); }
    }
  );

  server.tool(
    "source_get_topic",
    "Get a topic's full content and section structure from the Source knowledge graph.",
    {
      topicId: z.string().describe("Topic UUID"),
      resolve: z.boolean().optional().describe("If true, include resolved dependency chain"),
    },
    async ({ topicId, resolve }) => {
      try {
        const contentPath = `/api/pact/${topicId}/content${resolve ? "?resolve=true" : ""}`;
        const sectionsPath = `/api/pact/${topicId}/sections`;
        const [content, sections] = await Promise.all([
          sourceGet(contentPath),
          sourceGet(sectionsPath),
        ]);
        return jsonResult({ content, sections });
      } catch (e) { return errorResult(e); }
    }
  );

  server.tool(
    "source_query_facts",
    "Query verified facts (consensus/stable topics) from the Axiom API. Requires SOURCE_AXIOM_KEY.",
    {
      tier: z.string().optional().describe("Filter by tier (axiom, empirical, etc.)"),
      jurisdiction: z.string().optional().describe("Filter by jurisdiction"),
      q: z.string().optional().describe("Full-text search query"),
      limit: z.number().optional().describe("Max results (default 50, max 200)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    async ({ tier, jurisdiction, q, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (tier) params.set("tier", tier);
        if (jurisdiction) params.set("jurisdiction", jurisdiction);
        if (q) params.set("q", q);
        if (limit) params.set("limit", String(limit));
        if (offset) params.set("offset", String(offset));
        const qs = params.toString();
        return jsonResult(await sourceGet(`/api/axiom/facts${qs ? `?${qs}` : ""}`, true));
      } catch (e) { return errorResult(e); }
    }
  );

  server.tool(
    "source_search_legislation",
    "Full-text search across Australian legislation sections in the Source knowledge graph. Requires SOURCE_AXIOM_KEY.",
    {
      query: z.string().describe("Search query (e.g. 'mine safety', 'unfair dismissal')"),
      jurisdiction: z.string().optional().describe("Filter by jurisdiction: QLD, CTH, NSW"),
      type: z.string().optional().describe("Filter by doc type: act, regulation"),
      limit: z.number().optional().describe("Max results (default 20)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    async ({ query, jurisdiction, type, limit, offset }) => {
      try {
        const params = new URLSearchParams({ q: query });
        if (jurisdiction) params.set("jurisdiction", jurisdiction);
        if (type) params.set("type", type);
        if (limit) params.set("limit", String(limit));
        if (offset) params.set("offset", String(offset));
        return jsonResult(await sourceGet(`/api/axiom/legislation/search?${params}`, true));
      } catch (e) { return errorResult(e); }
    }
  );

  server.tool(
    "source_get_legislation",
    "Get a specific legislation document with all its sections from Source. Requires SOURCE_AXIOM_KEY.",
    {
      id: z.string().describe("Legislation document ID"),
      section: z.string().optional().describe("Filter to a specific section ID"),
    },
    async ({ id, section }) => {
      try {
        const params = new URLSearchParams();
        if (section) params.set("section", section);
        const qs = params.toString();
        const encodedId = encodeURIComponent(id);
        return jsonResult(await sourceGet(`/api/axiom/legislation/${encodedId}${qs ? `?${qs}` : ""}`, true));
      } catch (e) { return errorResult(e); }
    }
  );

  server.tool(
    "source_list_legislation",
    "List legislation documents in the Source knowledge graph, filterable by jurisdiction and type. Requires SOURCE_AXIOM_KEY.",
    {
      jurisdiction: z.string().optional().describe("Filter: QLD, CTH, NSW"),
      type: z.string().optional().describe("Filter: act, regulation"),
      q: z.string().optional().describe("Search by title"),
      limit: z.number().optional().describe("Max results"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    async ({ jurisdiction, type, q, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (jurisdiction) params.set("jurisdiction", jurisdiction);
        if (type) params.set("type", type);
        if (q) params.set("q", q);
        if (limit) params.set("limit", String(limit));
        if (offset) params.set("offset", String(offset));
        const qs = params.toString();
        return jsonResult(await sourceGet(`/api/axiom/legislation${qs ? `?${qs}` : ""}`, true));
      } catch (e) { return errorResult(e); }
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Source MCP server failed to start:", err);
  process.exit(1);
});
