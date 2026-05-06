#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const BASE_URL = process.env.SOURCE_BASE_URL || "https://source.tailor.au";
const AXIOM_KEY = process.env.SOURCE_AXIOM_KEY || "";
const PACT_KEY = process.env.SOURCE_PACT_KEY || "";
// #1160 Round 5 — agent-scoped key for the reciprocal work economy (claim + submit).
const AGENT_KEY = process.env.SOURCE_AGENT_KEY || "";
function jsonResult(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
async function postAgent(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-source-agent-key": AGENT_KEY,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0, 200)}`);
    }
    return res.json();
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
        version: "0.5.0",
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
    // ── Fuel Tools ───────────────────────────────────────────────────
    server.tool("source_cheapest_fuel", "Find the cheapest fuel stations right now. Free, real-time prices from 1,500+ QLD stations.", {
        fuelType: z.string().optional().describe("Fuel type: U91, U95, U98, E10, Diesel, PremDSL, LPG, E85, AdBlue (default: U91)"),
        state: z.string().optional().describe("State: QLD, NSW, VIC, WA, SA, ACT, TAS, NT"),
        limit: z.number().optional().describe("Max results (default: 10)"),
    }, async ({ fuelType, state, limit }) => {
        try {
            const params = new URLSearchParams();
            if (fuelType)
                params.set("fuelType", fuelType);
            if (state)
                params.set("state", state);
            if (limit)
                params.set("limit", String(limit));
            const qs = params.toString();
            return jsonResult(await sourceGet(`/api/market/fuel/cheapest${qs ? `?${qs}` : ""}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_fuel_near_me", "Find fuel stations near a GPS location. Returns stations sorted by distance with current prices.", {
        latitude: z.number().describe("GPS latitude"),
        longitude: z.number().describe("GPS longitude"),
        fuelType: z.string().optional().describe("Fuel type (default: U91)"),
        radiusKm: z.number().optional().describe("Search radius in km (default: 10)"),
        limit: z.number().optional().describe("Max results (default: 10)"),
    }, async ({ latitude, longitude, fuelType, radiusKm, limit }) => {
        try {
            const params = new URLSearchParams({
                latitude: String(latitude),
                longitude: String(longitude),
            });
            if (fuelType)
                params.set("fuelType", fuelType);
            if (radiusKm)
                params.set("radiusKm", String(radiusKm));
            if (limit)
                params.set("limit", String(limit));
            return jsonResult(await sourceGet(`/api/market/fuel/near-me?${params}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_fuel_search", "Search fuel stations by type, state, or suburb.", {
        fuelType: z.string().describe("Fuel type: Diesel, U91, U95, U98, E10, LPG"),
        state: z.string().optional().describe("State filter"),
        suburb: z.string().optional().describe("Suburb filter"),
        limit: z.number().optional().describe("Max results (default: 20)"),
    }, async ({ fuelType, state, suburb, limit }) => {
        try {
            const params = new URLSearchParams({ fuelType });
            if (state)
                params.set("state", state);
            if (suburb)
                params.set("suburb", suburb);
            if (limit)
                params.set("limit", String(limit));
            return jsonResult(await sourceGet(`/api/market/fuel/search?${params}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_fuel_summary", "Get a national or state-level fuel price summary — average, min, max prices by fuel type.", {
        state: z.string().optional().describe("State filter (omit for national summary)"),
    }, async ({ state }) => {
        try {
            const qs = state ? `?state=${state}` : "";
            return jsonResult(await sourceGet(`/api/market/fuel/summary${qs}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_station_prices", "Get all current fuel prices at a specific station.", {
        stationId: z.string().describe("Station UUID"),
    }, async ({ stationId }) => {
        try {
            return jsonResult(await sourceGet(`/api/market/fuel/stations/${stationId}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_fuel_history", "Get price history for a fuel type at a specific station.", {
        stationId: z.string().describe("Station UUID"),
        fuelType: z.string().describe("Fuel type"),
        days: z.number().optional().describe("History period in days (default: 30)"),
    }, async ({ stationId, fuelType, days }) => {
        try {
            const params = new URLSearchParams({ stationId, fuelType });
            if (days)
                params.set("days", String(days));
            return jsonResult(await sourceGet(`/api/market/fuel/history?${params}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    // ── Scenario Tools (#1152) ──────────────────────────────────────
    server.tool("source_match_scenario", "Match a set of caller predicates against the Source scenario library. Returns ranked scenarios by confidence, plus an LLM fallback if no scenario scores above 0.5. Unauthenticated; free.", {
        predicates: z.record(z.unknown()).describe("Key/value predicates describing the caller's situation (e.g. { country_of_operation: 'AU', counterparty_country: 'US', product_class: 'defence_dual_use' })"),
    }, async ({ predicates }) => {
        try {
            const res = await fetch(`${BASE_URL}/api/scenarios/match`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ predicates }),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
            }
            return jsonResult(await res.json());
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_list_applicable_law", "Given a scenario id, return the full applicability subgraph (scenario + applies_when edges + co_applies edges + resolved topic/legislation metadata) flattened for LLM prompt injection.", {
        scenarioId: z.string().describe("Scenario id (e.g. 'scn.au-defence-export-to-us')"),
    }, async ({ scenarioId }) => {
        try {
            const encoded = encodeURIComponent(scenarioId);
            return jsonResult(await sourceGet(`/api/scenarios/${encoded}/applicable`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    // ── Applicability Spot-check Tools (#1160 Round 5) ─────────────
    server.tool("source_submit_applicability_prediction", "Earn 3 credits by predicting which scenarios apply to a given predicate set BEFORE the graph is consulted (blind_predict mode). Deterministic validator: F1 >= 0.66 vs canonical match or rejected. Requires SOURCE_AGENT_KEY. Wrapper over POST /api/work/claim + POST /api/work/submit.", {
        predicates: z.record(z.unknown()).describe("Caller predicates (e.g. { country_of_operation: 'AU', handles_personal_information: true })"),
        predictedScenarioIds: z.array(z.string()).describe("Scenario ids the caller predicts will apply (before looking at the graph)"),
        rationale: z.string().min(80).describe("80+ chars explaining the prediction reasoning (mandatory — validator rejects short rationales)"),
    }, async ({ predicates, predictedScenarioIds, rationale }) => {
        try {
            if (!AGENT_KEY) {
                return errorResult("SOURCE_AGENT_KEY not configured. Register via POST /api/work/register to get an agent key.");
            }
            const claim = await postAgent("/api/work/claim", { workType: "applicability_spotcheck" });
            const assignmentId = claim?.assignmentId;
            if (!assignmentId) {
                throw new Error(`claim did not return assignmentId: ${JSON.stringify(claim).slice(0, 200)}`);
            }
            const submit = await postAgent("/api/work/submit", {
                assignmentId,
                submission: {
                    mode: "blind_predict",
                    predicates,
                    predictedScenarioIds,
                    rationale,
                },
            });
            return jsonResult({ assignmentId, ...(submit ?? {}) });
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_review_scenario_applicability", "Earn up to 5 credits per accepted submission by spot-checking an existing scenario's applies_when edges (review_existing mode). Confirm edges (1 credit each, cap 3), flag defects (reject / missing, 3 credits each, DEFERRED until a curator resolves). Requires SOURCE_AGENT_KEY. Findings must cite reasons >= 40 chars; overall rationale >= 120 chars.", {
        scenarioId: z.string().describe("Scenario id to review (e.g. 'scn.au-privacy-personal-info')"),
        rationale: z.string().min(120).describe("120+ chars explaining overall assessment"),
        findings: z.array(z.object({
            action: z.enum(["confirm", "reject", "missing"]).describe("confirm existing edge | reject existing edge | flag missing edge"),
            edgeId: z.string().optional().describe("Required for confirm/reject: the applies_when edge id"),
            targetKind: z.enum(["topic", "legislation"]).optional().describe("Required for missing: what kind of node should be linked"),
            targetId: z.string().optional().describe("Required for missing: the topic or legislation id"),
            reason: z.string().min(40).describe("40+ chars justifying this finding"),
        })).min(1).describe("At least one finding. Confirms-only with reasons < 40 chars are rejected."),
    }, async ({ scenarioId, rationale, findings }) => {
        try {
            if (!AGENT_KEY) {
                return errorResult("SOURCE_AGENT_KEY not configured. Register via POST /api/work/register to get an agent key.");
            }
            const claim = await postAgent("/api/work/claim", { workType: "applicability_spotcheck" });
            const assignmentId = claim?.assignmentId;
            if (!assignmentId) {
                throw new Error(`claim did not return assignmentId: ${JSON.stringify(claim).slice(0, 200)}`);
            }
            const submit = await postAgent("/api/work/submit", {
                assignmentId,
                submission: {
                    mode: "review_existing",
                    scenarioId,
                    rationale,
                    findings,
                },
            });
            return jsonResult({ assignmentId, ...(submit ?? {}) });
        }
        catch (e) {
            return errorResult(e);
        }
    });
    // ── Evidence Pack Tools (#876) ─────────────────────────────────
    server.tool("source_get_evidence_pack", "Assemble a complete, traceable evidence pack for a Queensland property development assessment. Composes statute citations, spatial derived facts (flood/zoning/heritage), TOD catchment membership, and cadastre geometry into a single verified response. Provide lotPlan (e.g. '123RP456789') and/or lat+lon.", {
        lotPlan: z.string().optional().describe("QLD lot-plan reference (e.g. '123RP456789') — fetches cadastre polygon"),
        lat: z.number().optional().describe("Parcel centroid latitude (decimal degrees)"),
        lon: z.number().optional().describe("Parcel centroid longitude (decimal degrees)"),
        domain: z.string().optional().describe("Evidence domain (default: 'property_development')"),
        legislationQuery: z.string().optional().describe("Search term for statute citations (default: 'planning development')"),
    }, async ({ lotPlan, lat, lon, domain, legislationQuery }) => {
        try {
            if (!lotPlan && (lat == null || lon == null)) {
                return errorResult("Provide lotPlan or both lat and lon");
            }
            const body = {};
            if (lotPlan)
                body.lotPlan = lotPlan;
            if (lat != null)
                body.lat = lat;
            if (lon != null)
                body.lon = lon;
            if (domain)
                body.domain = domain;
            if (legislationQuery)
                body.legislationQuery = legislationQuery;
            const res = await fetch(`${BASE_URL}/api/source/evidence-pack`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0, 200)}`);
            }
            return jsonResult(await res.json());
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_verify_claim", "Check a factual claim against the Source knowledge graph — searches legislation sections and institutional topics for supporting or contradicting evidence. Returns ranked evidence with confidence levels and traceability.", {
        claim: z.string().describe("The factual claim to verify (e.g. 'Development within 400m of a train station requires TOD assessment')"),
        jurisdiction: z.string().optional().describe("Filter: QLD, CTH, NSW"),
        domain: z.string().optional().describe("Scope to a domain (e.g. 'property_development')"),
        limit: z.number().optional().describe("Max evidence items returned (default: 5)"),
    }, async ({ claim, jurisdiction, domain, limit }) => {
        try {
            const params = new URLSearchParams({ q: claim });
            if (jurisdiction)
                params.set("jurisdiction", jurisdiction);
            if (limit)
                params.set("limit", String(limit));
            const legResults = await sourceGet(`/api/axiom/legislation/search?${params}`);
            const topicParams = new URLSearchParams({ q: claim });
            if (jurisdiction)
                topicParams.set("jurisdiction", jurisdiction);
            if (domain)
                topicParams.set("domain", domain);
            topicParams.set("limit", String(limit ?? 5));
            let topicResults = null;
            try {
                topicResults = await sourceGet(`/api/pact/topics?${topicParams}`);
            }
            catch { /* topics search is best-effort */ }
            return jsonResult({
                claim,
                searchedAt: new Date().toISOString(),
                legislation: legResults,
                topics: topicResults,
                note: "Evidence is ranked by full-text relevance. Review each item's derivedFrom and limitations before citing.",
            });
        }
        catch (e) {
            return errorResult(e);
        }
    });
    server.tool("source_get_source_graph", "Get the dependency graph for a Source topic — resolves builds_on, assumes, and co_applies edges recursively to show the full evidential chain supporting a knowledge claim.", {
        topicId: z.string().describe("Topic UUID or scenario id"),
        depth: z.number().optional().describe("Dependency resolution depth (1=direct, 2=transitive, default: 2)"),
    }, async ({ topicId, depth }) => {
        try {
            const encoded = encodeURIComponent(topicId);
            const depthParam = depth != null ? `?depth=${depth}` : "";
            let graph = null;
            try {
                graph = await sourceGet(`/api/pact/${encoded}/dependencies${depthParam}`);
            }
            catch {
                graph = await sourceGet(`/api/pact/${encoded}/content?resolve=true`);
            }
            return jsonResult({ topicId, graph });
        }
        catch (e) {
            return errorResult(e);
        }
    });
    // ── Market: Quote Rates (#1192) ─────────────────────────────────
    server.tool("source_quote_rates", "Get canonical retail rates for material item-keys across linked AU retailers. Returns cheapest per key plus all observations for comparison. Used by Traide for live quote pricing (replaces hardcoded TRADE_TEMPLATES rates). Public, unauthenticated. Item-key examples: wall-tile-porcelain, grout-floor, paint-primer, treated-pine-90x45, colorbond-roof-sheet.", {
        items: z
            .array(z.string())
            .min(1)
            .max(64)
            .describe("Item keys, e.g. ['wall-tile-porcelain','waterproofing-membrane','grout-floor']"),
    }, async ({ items }) => {
        try {
            const qs = new URLSearchParams({ items: items.join(",") }).toString();
            return jsonResult(await sourceGet(`/api/market/quote-rates?${qs}`));
        }
        catch (e) {
            return errorResult(e);
        }
    });
    // ── Contribution Tools ──────────────────────────────────────────
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