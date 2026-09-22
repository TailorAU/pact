export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { debitIfAuthenticated } from "@/lib/wallet-debit";
import { log } from "@/lib/logger";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  designationMatchBoost,
  escapeLike,
  extractDesignations,
  titleMatchBoost,
  tokenizeQuery,
} from "@/lib/legislation-ranking";
import { formatSourceRef, sectionKindOf } from "@/lib/section-citability";

export const OPTIONS = corsPreflight;

// GET /api/axiom/legislation/search — Full-text search across all legislation
//
// Free, unauthenticated, cross-origin (CORS `*` via lib/cors.ts, #2738).
// Australian legislation is a public good.
// When an agent supplies `x-source-agent-key`, we debit 1 credit per call
// (reason `read.legislation`) — anonymous reads stay free.
//
// Query params:
//   q                   — Search query (required). Searches title, section content, section IDs.
//   jurisdiction        — Optional filter: "QLD", "CTH", "NSW", etc. (filters results to this jurisdiction)
//   preferJurisdiction  — Optional ranking signal (#1250): "AU-QLD", "AU-NSW", "AU-CTH", "AU", etc.
//                         Does NOT filter — boosts matching jurisdiction in relevance score.
//                         When absent and no `jurisdiction` filter is set, AU-rooted results
//                         get a mild default preference (+1) reflecting that this API's
//                         canonical scope is Australian legislation (see AGENTS.md § Source).
//   type                — Optional filter: "act", "regulation", "standard", "guidance"
//   status              — Optional section status filter: "in_force", "repealed", "not_yet_commenced"
//   limit/offset        — Pagination. limit is capped at 200; requests with limit > 200 return 400.
//
// Example: GET /api/axiom/legislation/search?q=assault&jurisdiction=QLD
// Example: GET /api/axiom/legislation/search?q=construction&preferJurisdiction=AU-QLD
//
// Content negotiation (#1360): when a browser hits this URL with
// `Accept: text/html` (and not specifically asking for JSON), redirect to
// the human-facing /search UI instead of returning JSON. This bounces
// users who land on the API URL via a clicked link or address-bar paste
// into the proper search experience. Programmatic callers (Accept: */*,
// application/json, missing header, MCP/agent SDKs) keep getting JSON.
// Important: redirect runs BEFORE debitIfAuthenticated so browser users
// don't accidentally consume agent credits.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const acceptHeader = req.headers.get("accept") ?? "";
  const wantsHtml =
    acceptHeader.includes("text/html") &&
    !acceptHeader.includes("application/json");
  if (wantsHtml) {
    // Use a RELATIVE Location header. Both `new URL("/search", req.url)` and
    // `req.nextUrl.clone()` resolve against the internal ACA pod URL
    // (`0.0.0.0:3000`) because the platform's reverse proxy doesn't expose
    // X-Forwarded-Host in a way that NextURL absorbs; an absolute redirect
    // would emit Location: https://0.0.0.0:3000/search which a user's
    // browser can't reach. Per RFC 7231 §7.1.2, a relative Location is
    // resolved by the user-agent against the request's effective URI —
    // which IS the public-facing URL the user typed. Manual `Response` (no
    // `NextResponse.redirect` URL serialisation) preserves the relative
    // form. All searchParams flow through (q, jurisdiction, type, status,
    // preferJurisdiction, offset).
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.set(key, value);
    });
    const qs = params.toString();
    return withCors(new Response(null, {
      status: 303,
      headers: {
        Location: qs ? `/search?${qs}` : "/search",
      },
    }));
  }

  const debit = await debitIfAuthenticated(req, 1, "read.legislation");
  if (!debit.ok) {
    return withCors(NextResponse.json(debit.body, { status: debit.status }));
  }
  const query = searchParams.get("q");
  const jurisdiction = searchParams.get("jurisdiction");
  const preferJurisdictionRaw = searchParams.get("preferJurisdiction");
  const docType = searchParams.get("type");
  const sectionStatus = searchParams.get("status");

  // WS11 — enforce LIMIT cap. Callers supplying limit > 200 get a 400 so
  // they know their parameter was rejected (vs silently clamped, which
  // masks misuse). Default 50, max 200.
  const rawLimit = parseInt(searchParams.get("limit") || "50");
  if (rawLimit > 200) {
    return withCors(NextResponse.json(
      { error: "limit_too_high", message: "limit must be ≤ 200", maxLimit: 200 },
      { status: 400 }
    ));
  }
  const limit = rawLimit;
  const offset = parseInt(searchParams.get("offset") || "0");

  if (!query) {
    return withCors(NextResponse.json({
      error: "Missing required query parameter: q",
      example: "/api/axiom/legislation/search?q=assault&jurisdiction=QLD",
    }, { status: 400 }));
  }

  // Tokenize query into keywords (3+ chars). pact#28 ask-2: designation-aware
  // — a standards reference like "AS/NZS 4308" or "ISO 45001:2018" keeps its
  // canonical designation ("as/nzs 4308") as a first-class searchable token
  // instead of being shredded by punctuation stripping into ["nzs","4308"].
  const keywords = tokenizeQuery(query);
  const designations = extractDesignations(query);

  if (keywords.length === 0) {
    return withCors(NextResponse.json({
      error: "Query too short. Please provide at least one word with 3+ characters.",
    }, { status: 400 }));
  }

  // ── #1250 — signal-driven ranking helpers ───────────────────────────
  // Normalise the optional caller preference. The bare `AU` value acts as
  // "any AU result is better than non-AU". `AU-QLD` etc. narrow further.
  const preferJurisdiction = preferJurisdictionRaw
    ? preferJurisdictionRaw.toUpperCase()
    : null;

  // Default AU-root bias applies ONLY when caller didn't filter AND didn't
  // prefer a jurisdiction explicitly. Driven by the dataset's documented
  // scope (AU legislation is a public good per AGENTS.md § Source), not by
  // any particular vertical or tenant.
  const applyDefaultAuBias = !jurisdiction && !preferJurisdiction;

  // Whole-word keyword match for title/section_id boosts. Content scoring
  // intentionally remains substring-based (high recall). This prevents
  // `non-construction` from scoring as `construction` at the boost layer
  // while still counting every substring hit in content.
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordBoundaryHit = (text: string, kw: string): boolean => {
    if (!text) return false;
    return new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(text);
  };
  // Negation guard: `non-<kw>` or `non <kw>` immediately preceding the
  // keyword disqualifies the title boost for THAT keyword. Deterministic,
  // no NLP. Other keywords in the same title still score normally.
  const negatedInText = (text: string, kw: string): boolean => {
    if (!text) return false;
    return new RegExp(`non[-\\s]${escapeRegex(kw)}\\b`, "i").test(text);
  };

  // Jurisdiction boost — caller preference trumps default AU bias.
  // Returns an additive score adjustment (0, 1, or 2).
  const jurisdictionBoost = (hitJurisdiction: string | null): number => {
    if (!hitJurisdiction) return 0;
    const hj = hitJurisdiction.toUpperCase();
    if (preferJurisdiction) {
      // Exact match or sub-jurisdiction match (e.g. prefer "AU" matches "AU-QLD")
      if (hj === preferJurisdiction || hj.startsWith(`${preferJurisdiction}-`)) {
        return 2;
      }
      // Parent-jurisdiction match (e.g. prefer "AU-QLD" still rewards "AU"
      // over non-AU — softer boost because it's less specific).
      if (preferJurisdiction.includes("-")) {
        const parent = preferJurisdiction.split("-")[0];
        if (hj === parent || hj.startsWith(`${parent}-`)) return 1;
      }
      return 0;
    }
    if (applyDefaultAuBias) {
      // Mild bias toward AU-rooted results on a bare query. Reflects the
      // dataset's canonical scope; callers who want other jurisdictions
      // can set `jurisdiction=` or `preferJurisdiction=` explicitly.
      if (hj === "AU" || hj.startsWith("AU-")) return 1;
    }
    return 0;
  };

  const db = await getDb();

  // Build WHERE conditions for the main query
  const conditions: string[] = [];
  const args: unknown[] = [];

  // At least one keyword must match in section content, title, or section_id
  const keywordMatchParts: string[] = [];
  for (const kw of keywords) {
    const p = `%${kw}%`;
    keywordMatchParts.push(
      `(LOWER(ls.content) LIKE ? OR LOWER(COALESCE(ls.title, '')) LIKE ? OR LOWER(ls.section_id) LIKE ? OR LOWER(d.title) LIKE ?)`
    );
    args.push(p, p, p, p);
  }
  conditions.push(`(${keywordMatchParts.join(" OR ")})`);

  if (jurisdiction) {
    conditions.push("(d.jurisdiction = ? OR d.jurisdiction LIKE ? || '-%')");
    args.push(jurisdiction.toUpperCase(), jurisdiction.toUpperCase());
  }
  if (docType) {
    conditions.push("d.doc_type = ?");
    args.push(docType.toLowerCase());
  }
  if (sectionStatus) {
    conditions.push("ls.status = ?");
    args.push(sectionStatus);
  }

  const where = conditions.join(" AND ");

  // Count total matches
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM legislation_sections ls JOIN legislation_docs d ON d.id = ls.doc_id WHERE ${where}`,
    args,
  });
  const total = (countResult.rows[0]?.total as number) || 0;

  // Fetch results — sorted by doc then sort_order.
  //
  // pact#28 ask-2 — exact/near-exact TITLE hits must land inside the fetch
  // window even when another doc's body-text matches would alphabetically
  // fill the LIMIT page first (live repro: "Privacy Act 1988" fetched 50
  // Coal Mining Safety and Health Act sections — "C" < "P" — and never saw
  // the Privacy Act rows). Rows whose doc title starts with the query sort
  // first; the JS-side relevance scoring below stays authoritative.
  const titleFirstPattern = `${escapeLike(query.toLowerCase().trim())}%`;
  const result = await db.execute({
    sql: `SELECT
      ls.id,
      ls.doc_id,
      ls.section_id,
      ls.title as section_title,
      ls.content,
      ls.depth,
      ls.status as section_status,
      ls.cross_references,
      ls.notes,
      d.title as doc_title,
      d.jurisdiction,
      d.doc_type,
      d.year,
      d.short_title,
      d.administered_by
    FROM legislation_sections ls
    JOIN legislation_docs d ON d.id = ls.doc_id
    WHERE ${where}
    ORDER BY CASE WHEN LOWER(d.title) LIKE ? THEN 0 ELSE 1 END, d.title ASC, ls.sort_order ASC
    LIMIT ? OFFSET ?`,
    args: [...args, titleFirstPattern, limit, offset],
  });


  // Format results with highlighted matches
  const results = result.rows.map((row) => {
    let content = row.content as string;
    // Highlight keyword matches with ** markers
    for (const kw of keywords) {
      const regex = new RegExp(`(${escapeRegex(kw)})`, "gi");
      content = content.replace(regex, "**$1**");
    }

    // #1250 relevance: whole-word boosts for title/section_id (negation-
    // guarded); substring occurrences in content; jurisdiction signal.
    const lowerContent = (row.content as string).toLowerCase();
    const sectionTitle = (row.section_title as string) || "";
    const docTitle = (row.doc_title as string) || "";
    const sectionId = (row.section_id as string) || "";
    const rowJurisdiction = (row.jurisdiction as string | null) || null;

    let score = 0;
    for (const kw of keywords) {
      // Title match — whole-word, negation-guarded. Check both the section
      // title and the parent doc title (either counts as a title hit).
      const titleHit =
        (wordBoundaryHit(sectionTitle, kw) && !negatedInText(sectionTitle, kw)) ||
        (wordBoundaryHit(docTitle, kw) && !negatedInText(docTitle, kw));
      if (titleHit) score += 3;
      // Section ID match — whole-word.
      if (wordBoundaryHit(sectionId, kw)) score += 3;
      // Count substring occurrences in content (high recall).
      let idx = -1;
      while ((idx = lowerContent.indexOf(kw, idx + 1)) !== -1) score += 1;
    }
    score += jurisdictionBoost(rowJurisdiction);
    // pact#28 ask-2 — an exact or near-exact TITLE match always outranks
    // body-text fuzzy matches ("Coal Mining Safety and Health Regulation
    // 2017" must return qld/reg-2017-165 ahead of the Act's body hits), and
    // a standards-designation hit lifts the designated node over stray
    // numeric substring matches.
    score += titleMatchBoost(query, docTitle, sectionTitle);
    score += designationMatchBoost(designations, docTitle, sectionTitle, sectionId);

    return {
      docId: row.doc_id,
      docTitle: row.doc_title,
      jurisdiction: row.jurisdiction,
      docType: row.doc_type,
      year: row.year,
      sectionId: row.section_id,
      sectionTitle: row.section_title || null,
      content,
      depth: row.depth,
      status: row.section_status,
      relevanceScore: score,
      crossReferences: row.cross_references ? JSON.parse(row.cross_references as string) : [],
      // #5092 — the API-side mirror of the Tailor-side #5083 fix. A
      // synthetic storage key (`chunk-1`, a raw GUID, missing) is never
      // composed into the citation string: the hit stays findable, but
      // `sourceRef` degrades to the DOC-level citation and `sectionKind`
      // carries the machine-readable signal. A real pinpoint keeps the
      // pre-existing `"<short||doc> <id>"` shape byte-identically.
      sectionKind: sectionKindOf(row.section_id as string),
      sourceRef: formatSourceRef(
        row.short_title as string | null,
        row.doc_title as string,
        row.section_id as string
      ),
    };
  });

  // ── Topics union (#1137) ────────────────────────────────────────────
  // PACT topics carry canonical regulatory claims (institutional tier) that
  // are not stored in legislation_sections. Surface them as a second result
  // source so a single /search call covers both the machine-ingested
  // legislation catalogue and the agent-verified topic graph.
  //
  // Contract: topic hits fill the same result shape as section hits with
  //   docId        = `topic:{id}`
  //   sectionId    = "claim"
  //   docType      = "topic"
  //   content      = topic.canonical_claim || topic.content (highlighted)
  //   sourceRef    = topic.source_ref || topic.title
  // Richer clients can branch on docType === "topic" and deep-link to
  // `/topics/{id}` instead of `/legislation/{docId}/{sectionId}`.
  //
  // WS11 — the topic DB query runs inside a 5-second Promise.race. If the
  // topics table is slow (large graph, lock contention, cold replica), we
  // return the base legislation results immediately with topicsFederated:
  // false rather than timing out the whole request. A warn log records the
  // elapsed time so ops can diagnose patterns.
  const topicKeywordParts: string[] = [];
  const topicArgs: unknown[] = [];
  for (const kw of keywords) {
    const p = `%${kw}%`;
    topicKeywordParts.push(
      "(LOWER(title) LIKE ? OR LOWER(COALESCE(canonical_claim, '')) LIKE ? OR LOWER(content) LIKE ? OR LOWER(COALESCE(source_ref, '')) LIKE ?)"
    );
    topicArgs.push(p, p, p, p);
  }
  const topicConds: string[] = [`(${topicKeywordParts.join(" OR ")})`];
  if (jurisdiction) {
    // Match "AU", "AU-QLD", "AU-*"; also allow INTERNATIONAL-scoped hits to
    // appear on an unqualified query by only filtering when the caller asked.
    topicConds.push("(jurisdiction = ? OR jurisdiction LIKE ? || '-%')");
    topicArgs.push(jurisdiction.toUpperCase(), jurisdiction.toUpperCase());
  }
  // Skip topics entirely if the caller filters by a legislation-specific
  // docType — topics are not legislation_docs.
  const skipTopics = !!docType && docType.toLowerCase() !== "topic";

  type TopicHit = {
    docId: string;
    docTitle: string;
    jurisdiction: string | null;
    docType: string;
    year: null;
    sectionId: string;
    sectionTitle: string | null;
    content: string;
    depth: number;
    status: string;
    relevanceScore: number;
    crossReferences: unknown[];
    sectionKind: string;
    sourceRef: string;
  };

  // WS11 — 5 s timeout for the topic-federation half. topicsFederated
  // signals to callers whether the response includes topic results.
  let topicHits: TopicHit[] = [];
  let topicsFederated = false;

  if (!skipTopics) {
    const TOPIC_TIMEOUT_MS = 5000;
    const federationStart = Date.now();

    // pact#28 ask-2 — same fetch-window guarantee as the legislation half:
    // topics whose title starts with the query sort ahead of status/recency
    // ordering so an exact-citation topic is always inside the LIMIT page.
    const topicQueryPromise = db.execute({
      sql: `SELECT id, title, content, canonical_claim, tier, status, jurisdiction, authority, source_ref
            FROM topics
            WHERE ${topicConds.join(" AND ")}
            ORDER BY
              CASE WHEN LOWER(title) LIKE ? THEN 0 ELSE 1 END,
              CASE status WHEN 'locked' THEN 0 WHEN 'consensus' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
              created_at DESC
            LIMIT ?`,
      args: [...topicArgs, titleFirstPattern, limit],
    });

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TOPIC_TIMEOUT_MS)
    );

    const topicRace = await Promise.race([topicQueryPromise, timeoutPromise]);

    if (topicRace === null) {
      // Timeout — return base legislation results without topics
      const elapsedMs = Date.now() - federationStart;
      log.warn(
        { op: "axiom.legislation.search.federation_timeout", elapsedMs, q: query },
        "topic federation timed out; returning base legislation results"
      );
      topicsFederated = false;
    } else {
      // Success — map topic rows to the unified hit shape
      topicsFederated = true;
      topicHits = topicRace.rows.map((row) => {
        const claim = (row.canonical_claim as string | null) || (row.content as string);
        const title = row.title as string;
        const lowerClaim = claim.toLowerCase();
        const rowTier = (row.tier as string | null) || null;
        const rowStatus = (row.status as string | null) || null;
        const rowJurisdiction = (row.jurisdiction as string | null) ?? null;

        // #1250 — balanced title scoring. Topics used to get +5 per title
        // keyword hit while legislation got +3; that lift was unjustified
        // (it's an authority signal, not a relevance signal). Move it to a
        // separate institutional-tier / locked-consensus bonus and score
        // title matches at parity with legislation.
        let score = 0;
        for (const kw of keywords) {
          const titleHit = wordBoundaryHit(title, kw) && !negatedInText(title, kw);
          if (titleHit) score += 3;
          // Count substring occurrences in the canonical claim (high recall).
          let idx = -1;
          while ((idx = lowerClaim.indexOf(kw, idx + 1)) !== -1) score += 1;
        }
        // Authority bonus: institutional-tier topics that have reached
        // locked consensus deserve a small surface lift, independent of
        // keyword match quality.
        if (rowTier === "institutional" && rowStatus === "locked") score += 1;
        score += jurisdictionBoost(rowJurisdiction);
        // pact#28 ask-2 — exact / near-exact TITLE match dominance and
        // standards-designation lift, at parity with the legislation half.
        // Topic claim-sentence titles ("Privacy Act 1988 (Cth) establishes…")
        // count as near-exact for the citation query "Privacy Act 1988".
        const rowSourceRef = (row.source_ref as string | null) || null;
        score += titleMatchBoost(query, title);
        score += designationMatchBoost(designations, title, rowSourceRef);

        // Trim to ~600 chars before highlighting so the payload stays bounded.
        let snippet = claim.length > 600 ? claim.slice(0, 600) + "…" : claim;
        for (const kw of keywords) {
          const regex = new RegExp(`(${escapeRegex(kw)})`, "gi");
          snippet = snippet.replace(regex, "**$1**");
        }
        return {
          docId: `topic:${row.id as string}`,
          docTitle: title,
          jurisdiction: rowJurisdiction,
          docType: "topic",
          year: null,
          sectionId: "claim",
          sectionTitle: "Canonical claim",
          content: snippet,
          depth: 0,
          status: rowStatus || "proposed",
          relevanceScore: score,
          crossReferences: [],
          // #5092 — topics are claims, not sections; their sourceRef is
          // already a curated citation. `sectionKind: "claim"` completes
          // the pinpoint | extract | claim vocabulary for consumers.
          sectionKind: "claim",
          sourceRef: (row.source_ref as string | null) || title,
        };
      });
    }
  }

  // Merge + dedupe-by-docId, keep the highest-scoring hit per doc (topics
  // have docId `topic:{id}` so cannot collide with legislation docIds).
  const merged = [...results, ...topicHits];
  merged.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return withCors(NextResponse.json({
    results: merged,
    query,
    keywords,
    total: total + topicHits.length,
    sources: {
      legislation: results.length,
      topics: topicHits.length,
    },
    // WS11 — topicsFederated: true means topic results are included in this
    // response. false means the topic DB query timed out (>5s) and only
    // legislation_sections results are returned. Callers can use this flag
    // to decide whether to retry or surface a partial-results notice.
    topicsFederated,
    limit,
    offset,
    free: true,
    ranking: {
      // #1250 — surfaces which signals the ranker applied for this query.
      // Purely informational; callers can ignore this block.
      preferJurisdiction: preferJurisdiction,
      defaultAuBias: applyDefaultAuBias,
      titleMatch: "wholeWord+negationGuarded",
      // pact#28 ask-2 — surfaced so callers can see the citation-grade
      // signals: exact/near-exact title dominance + designation awareness.
      exactTitleFirst: true,
      designations: designations.map((d) => d.canonical),
    },
    _links: {
      self: `/api/axiom/legislation/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
      next: offset + limit < total
        ? `/api/axiom/legislation/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset + limit}`
        : null,
      // #1360 — human-facing surface for the same query. Agents can surface
      // this in their UI / share buttons / audit trails to give users a
      // browsable URL alongside the API response.
      html: `/search?${(() => {
        const p = new URLSearchParams();
        p.set("q", query);
        if (jurisdiction) p.set("jurisdiction", jurisdiction);
        if (docType) p.set("type", docType);
        if (sectionStatus) p.set("status", sectionStatus);
        if (preferJurisdiction) p.set("preferJurisdiction", preferJurisdiction);
        if (offset > 0) p.set("offset", String(offset));
        return p.toString();
      })()}`,
    },
  }));
}
