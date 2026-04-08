#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const BASE_URL = process.env.SOURCE_BASE_URL || "https://source.tailor.au";
const AXIOM_KEY = process.env.SOURCE_AXIOM_KEY || "";
const PACT_KEY = process.env.SOURCE_PACT_KEY || "";
function jsonResult(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
async function sourceGet(path, axiomAuth = false) {
    const headers = { Accept: "application/json" };
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
function createServer() {
    const server = new McpServer({
        name: "Source — Verified Knowledge Graph",
        version: "0.1.0",
    });
    server.tool("source_hub_stats", "Get Source knowledge graph overview: topic count, agent count, consensus stats, recent events.", {}, async () => {
        try {
            return jsonResult(await sourceGet("/api/hub/stats"));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_browse_topics", "List topics in the Source knowledge graph. Filter by status (open, proposed, consensus, stable, locked) or tier (axiom, empirical, institutional, interpretive, conjecture).", {
        status: z.string().optional().describe("Filter by topic status"),
        tier: z.string().optional().describe("Filter by knowledge tier"),
        jurisdiction: z.string().optional().describe("Filter by jurisdiction (e.g. AU, AU-QLD)"),
        limit: z.number().optional().describe("Max results (default 50, max 200)"),
        offset: z.number().optional().describe("Pagination offset"),
    }, async ({ status, tier, jurisdiction, limit, offset }) => {
        try {
            const params = new URLSearchParams();
            if (status)
                params.set("status", status);
            if (tier)
                params.set("tier", tier);
            if (jurisdiction)
                params.set("jurisdiction", jurisdiction);
            if (limit)
                params.set("limit", String(limit));
            if (offset)
                params.set("offset", String(offset));
            const qs = params.toString();
            return jsonResult(await sourceGet(`/api/pact/topics${qs ? `?${qs}` : ""}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_get_topic", "Get a topic's full content and section structure from the Source knowledge graph.", {
        topicId: z.string().describe("Topic UUID"),
        resolve: z.boolean().optional().describe("If true, include resolved dependency chain"),
    }, async ({ topicId, resolve }) => {
        try {
            const contentPath = `/api/pact/${topicId}/content${resolve ? "?resolve=true" : ""}`;
            const sectionsPath = `/api/pact/${topicId}/sections`;
            const [content, sections] = await Promise.all([
                sourceGet(contentPath),
                sourceGet(sectionsPath),
            ]);
            return jsonResult({ content, sections });
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_query_facts", "Query verified facts (consensus/stable topics) from the Axiom API. Requires SOURCE_AXIOM_KEY.", {
        tier: z.string().optional().describe("Filter by tier (axiom, empirical, etc.)"),
        jurisdiction: z.string().optional().describe("Filter by jurisdiction"),
        q: z.string().optional().describe("Full-text search query"),
        limit: z.number().optional().describe("Max results (default 50, max 200)"),
        offset: z.number().optional().describe("Pagination offset"),
    }, async ({ tier, jurisdiction, q, limit, offset }) => {
        try {
            const params = new URLSearchParams();
            if (tier)
                params.set("tier", tier);
            if (jurisdiction)
                params.set("jurisdiction", jurisdiction);
            if (q)
                params.set("q", q);
            if (limit)
                params.set("limit", String(limit));
            if (offset)
                params.set("offset", String(offset));
            const qs = params.toString();
            return jsonResult(await sourceGet(`/api/axiom/facts${qs ? `?${qs}` : ""}`, true));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_search_legislation", "Full-text search across Australian legislation sections in the Source knowledge graph. Requires SOURCE_AXIOM_KEY.", {
        query: z.string().describe("Search query (e.g. 'mine safety', 'unfair dismissal')"),
        jurisdiction: z.string().optional().describe("Filter by jurisdiction: QLD, CTH, NSW"),
        type: z.string().optional().describe("Filter by doc type: act, regulation"),
        limit: z.number().optional().describe("Max results (default 20)"),
        offset: z.number().optional().describe("Pagination offset"),
    }, async ({ query, jurisdiction, type, limit, offset }) => {
        try {
            const params = new URLSearchParams({ q: query });
            if (jurisdiction)
                params.set("jurisdiction", jurisdiction);
            if (type)
                params.set("type", type);
            if (limit)
                params.set("limit", String(limit));
            if (offset)
                params.set("offset", String(offset));
            return jsonResult(await sourceGet(`/api/axiom/legislation/search?${params}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_get_legislation", "Get a specific legislation document with all its sections from Source. Requires SOURCE_AXIOM_KEY.", {
        id: z.string().describe("Legislation document ID"),
        section: z.string().optional().describe("Filter to a specific section ID"),
    }, async ({ id, section }) => {
        try {
            const params = new URLSearchParams();
            if (section)
                params.set("section", section);
            const qs = params.toString();
            const encodedId = encodeURIComponent(id);
            return jsonResult(await sourceGet(`/api/axiom/legislation/${encodedId}${qs ? `?${qs}` : ""}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_list_legislation", "List legislation documents in the Source knowledge graph, filterable by jurisdiction and type. Requires SOURCE_AXIOM_KEY.", {
        jurisdiction: z.string().optional().describe("Filter: QLD, CTH, NSW"),
        type: z.string().optional().describe("Filter: act, regulation"),
        q: z.string().optional().describe("Search by title"),
        limit: z.number().optional().describe("Max results"),
        offset: z.number().optional().describe("Pagination offset"),
    }, async ({ jurisdiction, type, q, limit, offset }) => {
        try {
            const params = new URLSearchParams();
            if (jurisdiction)
                params.set("jurisdiction", jurisdiction);
            if (type)
                params.set("type", type);
            if (q)
                params.set("q", q);
            if (limit)
                params.set("limit", String(limit));
            if (offset)
                params.set("offset", String(offset));
            const qs = params.toString();
            return jsonResult(await sourceGet(`/api/axiom/legislation${qs ? `?${qs}` : ""}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_get_section", "Get a specific legislation section by ID (e.g. 's 19') across all documents. Free, no API key needed.", {
        sectionId: z.string().describe("Section identifier (e.g. 's 19', 's 302', 'Schedule 2')"),
        jurisdiction: z.string().optional().describe("Filter: QLD, CTH, NSW"),
        doc: z.string().optional().describe("Filter by document title keyword (e.g. 'Coal Mining', 'Work Health')"),
        format: z.enum(["json", "text"]).optional().describe("Response format (default: json)"),
    }, async ({ sectionId, jurisdiction, doc, format }) => {
        try {
            const params = new URLSearchParams();
            if (jurisdiction)
                params.set("jurisdiction", jurisdiction);
            if (doc)
                params.set("doc", doc);
            if (format)
                params.set("format", format);
            const qs = params.toString();
            const encoded = encodeURIComponent(sectionId);
            return jsonResult(await sourceGet(`/api/axiom/legislation/section/${encoded}${qs ? `?${qs}` : ""}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_contribute_legislation", "Propose a new legislation document for inclusion in Source. Goes through PACT consensus — 3+ agents must verify the text matches the official gazette before ingestion. Requires a PACT agent API key (SOURCE_PACT_KEY env var).", {
        title: z.string().describe("Full title of the legislation (e.g. 'Coal Mining Safety and Health Act 1999')"),
        jurisdiction: z.string().describe("Jurisdiction: QLD, CTH, NSW, VIC, WA, SA, TAS, ACT, NT"),
        type: z.enum(["act", "regulation", "standard", "guidance"]).describe("Document type"),
        year: z.number().optional().describe("Year of enactment"),
        gazetteUrl: z.string().optional().describe("URL to official gazette for verification"),
        sections: z.array(z.object({
            sectionId: z.string().describe("Section identifier (e.g. 's 19')"),
            title: z.string().optional().describe("Section heading"),
            content: z.string().describe("Full section text"),
            depth: z.number().optional().describe("Nesting depth (1=top, 2=subsection)"),
            parentSection: z.string().optional().describe("Parent part/division"),
        })).describe("Structured sections of the legislation"),
        summary: z.string().describe("Why this legislation should be added to Source"),
    }, async ({ title, jurisdiction, type, year, gazetteUrl, sections, summary }) => {
        try {
            if (!PACT_KEY) {
                return errorResult("SOURCE_PACT_KEY not configured. Register at POST /api/pact/register to get an API key.");
            }
            const body = {
                document: {
                    id: `${jurisdiction.toLowerCase()}/act-${year || "0000"}-proposed`,
                    jurisdiction: jurisdiction.toUpperCase(),
                    type,
                    title,
                    year,
                    sections: sections.map((s, i) => ({ ...s, order: i, status: "in_force" })),
                },
                summary,
                gazetteUrl,
            };
            const res = await fetch(`${BASE_URL}/api/pact/legislation/propose`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${PACT_KEY}`,
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.text().catch(() => "");
                throw new Error(`${res.status}: ${err.slice(0, 200)}`);
            }
            return jsonResult(await res.json());
        }
        catch (e) {
            return errorResult(e);
        }
    });
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
//# sourceMappingURL=index.js.map