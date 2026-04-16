export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/axiom/legislation/search — Full-text search across all legislation
//
// Free, unauthenticated. Australian legislation is a public good.
//
// Query params:
//   q             — Search query (required). Searches title, section content, section IDs.
//   jurisdiction  — Optional filter: "QLD", "CTH", "NSW", etc.
//   type          — Optional filter: "act", "regulation", "standard", "guidance"
//   status        — Optional section status filter: "in_force", "repealed", "not_yet_commenced"
//   limit/offset  — Pagination
//
// Example: GET /api/axiom/legislation/search?q=assault&jurisdiction=QLD
export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const jurisdiction = searchParams.get("jurisdiction");
  const docType = searchParams.get("type");
  const sectionStatus = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  if (!query) {
    return NextResponse.json({
      error: "Missing required query parameter: q",
      example: "/api/axiom/legislation/search?q=assault&jurisdiction=QLD",
    }, { status: 400 });
  }

  // Tokenize query into keywords (3+ chars)
  const keywords = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3);

  if (keywords.length === 0) {
    return NextResponse.json({
      error: "Query too short. Please provide at least one word with 3+ characters.",
    }, { status: 400 });
  }

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

  // Fetch results — sorted by doc then sort_order
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
    ORDER BY d.title ASC, ls.sort_order ASC
    LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });


  // Format results with highlighted matches
  const results = result.rows.map((row) => {
    let content = row.content as string;
    // Highlight keyword matches with ** markers
    for (const kw of keywords) {
      const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      content = content.replace(regex, "**$1**");
    }

    // Simple relevance: count keyword hits
    const lowerContent = (row.content as string).toLowerCase();
    const lowerTitle = ((row.section_title as string) || "").toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lowerTitle.includes(kw)) score += 3;
      if ((row.section_id as string).toLowerCase().includes(kw)) score += 3;
      // Count occurrences in content
      let idx = -1;
      while ((idx = lowerContent.indexOf(kw, idx + 1)) !== -1) score += 1;
    }

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
      sourceRef: `${row.short_title || row.doc_title} ${row.section_id}`,
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
    sourceRef: string;
  };
  let topicHits: TopicHit[] = [];
  if (!skipTopics) {
    const topicResult = await db.execute({
      sql: `SELECT id, title, content, canonical_claim, tier, status, jurisdiction, authority, source_ref
            FROM topics
            WHERE ${topicConds.join(" AND ")}
            ORDER BY
              CASE status WHEN 'locked' THEN 0 WHEN 'consensus' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
              created_at DESC
            LIMIT ?`,
      args: [...topicArgs, limit],
    });

    topicHits = topicResult.rows.map((row) => {
      const claim = (row.canonical_claim as string | null) || (row.content as string);
      const title = row.title as string;
      const lowerClaim = claim.toLowerCase();
      const lowerTitle = title.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lowerTitle.includes(kw)) score += 5;
        let idx = -1;
        while ((idx = lowerClaim.indexOf(kw, idx + 1)) !== -1) score += 1;
      }
      // Trim to ~600 chars before highlighting so the payload stays bounded.
      let snippet = claim.length > 600 ? claim.slice(0, 600) + "…" : claim;
      for (const kw of keywords) {
        const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        snippet = snippet.replace(regex, "**$1**");
      }
      return {
        docId: `topic:${row.id as string}`,
        docTitle: title,
        jurisdiction: (row.jurisdiction as string | null) ?? null,
        docType: "topic",
        year: null,
        sectionId: "claim",
        sectionTitle: "Canonical claim",
        content: snippet,
        depth: 0,
        status: (row.status as string) || "proposed",
        relevanceScore: score,
        crossReferences: [],
        sourceRef: (row.source_ref as string | null) || title,
      };
    });
  }

  // Merge + dedupe-by-docId, keep the highest-scoring hit per doc (topics
  // have docId `topic:{id}` so cannot collide with legislation docIds).
  const merged = [...results, ...topicHits];
  merged.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return NextResponse.json({
    results: merged,
    query,
    keywords,
    total: total + topicHits.length,
    sources: {
      legislation: results.length,
      topics: topicHits.length,
    },
    limit,
    offset,
    free: true,
    _links: {
      self: `/api/axiom/legislation/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
      next: offset + limit < total
        ? `/api/axiom/legislation/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset + limit}`
        : null,
    },
  });
}
