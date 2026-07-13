export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  escapeLike,
  extractDesignations,
  titleMatchTier,
  type TitleMatchTier,
} from "@/lib/legislation-ranking";
import { citationJurisdiction, jurisdictionMatches, parseCitation } from "@/lib/citation";

export const OPTIONS = corsPreflight;

// GET /api/axiom/resolve?citation=<string> — deterministic citation resolution
// (pact#28 ask-4, the Tailor Living Document "citation ownership" consumer).
//
// Free, unauthenticated, cross-origin — same posture as the other legislation
// reads (Australian legislation is a public good).
//
// Parses a citation of the shape:
//   <instrument name> [ (Cth|Qld|NSW|Vic|SA|WA|Tas|NT|ACT) ] [ s ###(#) ]
//   e.g. "Privacy Act 1988 (Cth) s 6(1)"
//        "Coal Mining Safety and Health Regulation 2017"
//        "AS/NZS 4308:2008"
// and resolves it EXACT-TITLE-FIRST against legislation_docs, THEN topics,
// using the ask-2 ranking primitives (titleMatchTier / extractDesignations).
//
// Contract: NEVER a fuzzy guess. A hit must classify as an exact or
// near-exact title match (per titleMatchTier) or the endpoint returns a
// 404-style miss. Multiple equally-good legislation candidates (e.g. the
// same title enacted in several jurisdictions, with no jurisdiction
// parenthetical to disambiguate) return a 404-style `citation_ambiguous`
// miss with the candidates listed — not a guess.
//
// Response 200:
//   { resolved: true, docId, docType, sectionRef, canonicalTitle,
//     verifiedRef, inForce, matchTier, jurisdiction, source, free: true }
//   - sectionRef: for legislation docs whose rows are content chunks
//     (section_id like "chunk-1"), a requested "s 42" resolves to the chunk
//     whose content contains that section marker; null when not resolvable.
//   - inForce: true/false from legislation_docs dates; null when unknown
//     (topics always null).
// Miss 404:
//   { resolved: false, error: "citation_not_resolved" | "citation_ambiguous",
//     citation, parsed, ... }

const TIER_RANK: Record<TitleMatchTier, number> = { exact: 2, "near-exact": 1, none: 0 };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const citation = searchParams.get("citation");

  if (!citation || !citation.trim()) {
    return withCors(
      NextResponse.json(
        {
          error: "Missing required query parameter: citation",
          example: "/api/axiom/resolve?citation=Privacy%20Act%201988%20(Cth)%20s%206",
        },
        { status: 400 }
      )
    );
  }

  const parsed = parseCitation(citation);
  if (!parsed.name) {
    return withCors(
      NextResponse.json(
        { resolved: false, error: "citation_not_resolved", citation, parsed, hint: "Citation has no instrument name." },
        { status: 404 }
      )
    );
  }

  const db = await getDb();
  const nameLower = parsed.name.toLowerCase();
  const designations = extractDesignations(parsed.name);

  // ── 1. Legislation docs — exact-title-first ───────────────────────────────
  // Candidate fetch is a title-prefix LIKE (bounded); classification is the
  // deterministic ask-2 titleMatchTier — exact beats near-exact, never fuzzy.
  const legConditions = ["LOWER(d.title) LIKE ?"];
  const legArgs: unknown[] = [`${escapeLike(nameLower)}%`];
  if (parsed.jurisdiction) {
    legConditions.push("(UPPER(d.jurisdiction) = ? OR UPPER(d.jurisdiction) = ?)");
    legArgs.push(parsed.jurisdiction, `AU-${parsed.jurisdiction}`);
  }
  const legResult = await db.execute({
    sql: `SELECT d.id, d.title, d.short_title, d.jurisdiction, d.doc_type, d.year,
                 d.in_force_date, d.repealed_date
          FROM legislation_docs d
          WHERE ${legConditions.join(" AND ")}
          ORDER BY d.title ASC
          LIMIT 10`,
    args: legArgs,
  });

  type LegCandidate = { row: Record<string, unknown>; tier: TitleMatchTier };
  const legCandidates: LegCandidate[] = legResult.rows
    .map((row) => ({ row, tier: titleMatchTier(parsed.name, String(row.title ?? "")) }))
    .filter((c) => c.tier !== "none" && jurisdictionMatches(c.row.jurisdiction, parsed.jurisdiction));

  const bestLegTier = legCandidates.reduce<TitleMatchTier>(
    (best, c) => (TIER_RANK[c.tier] > TIER_RANK[best] ? c.tier : best),
    "none"
  );
  const bestLeg = legCandidates.filter((c) => c.tier === bestLegTier);
  const distinctLegIds = [...new Set(bestLeg.map((c) => String(c.row.id)))];

  if (distinctLegIds.length > 1) {
    // Same-title instruments across jurisdictions with no disambiguating
    // parenthetical — a guess here would be fuzzy. Miss, with candidates.
    return withCors(
      NextResponse.json(
        {
          resolved: false,
          error: "citation_ambiguous",
          citation,
          parsed,
          candidates: bestLeg.map((c) => ({
            docId: c.row.id,
            title: c.row.title,
            jurisdiction: c.row.jurisdiction,
          })),
          hint: "Add a jurisdiction parenthetical, e.g. (Cth) or (Qld), to disambiguate.",
        },
        { status: 404 }
      )
    );
  }

  if (distinctLegIds.length === 1) {
    const doc = bestLeg[0].row;
    const docId = String(doc.id);

    // ── sectionRef resolution ────────────────────────────────────────────
    // Exact section_id first ("s 19" ingests exist), then the chunk whose
    // CONTENT contains the section marker (scraped docs store "chunk-N"
    // rows). Verified in JS — LIKE alone is not a marker match.
    let sectionRef: string | null = null;
    if (parsed.section) {
      const base = (parsed.section.match(/^\d+[A-Za-z]{0,3}/) ?? [parsed.section])[0];
      const variants = [
        parsed.section.toLowerCase(),
        `s ${parsed.section.toLowerCase()}`,
        base.toLowerCase(),
        `s ${base.toLowerCase()}`,
      ];
      const exactSec = await db.execute({
        sql: `SELECT section_id FROM legislation_sections
              WHERE doc_id = ? AND LOWER(section_id) IN (?, ?, ?, ?)
              ORDER BY sort_order ASC LIMIT 1`,
        args: [docId, ...variants],
      });
      if (exactSec.rows.length > 0) {
        sectionRef = String(exactSec.rows[0].section_id);
      } else {
        const candidates = await db.execute({
          sql: `SELECT section_id, content FROM legislation_sections
                WHERE doc_id = ? AND (section_id LIKE ? OR content LIKE ?)
                ORDER BY sort_order ASC LIMIT 200`,
          args: [docId, `%${escapeLike(base)}%`, `%${escapeLike(base)} %`],
        });
        const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // A section marker inside chunked content: a line starting with
        // "42 <Title>" / "42(1)", or an explicit "s 42" / "section 42".
        const markerRe = new RegExp(
          `(?:^|\\n)\\s*${escaped}\\s*(?:\\([0-9A-Za-z]+\\))?\\s+[A-Z(]|\\bs(?:ection)?\\.?\\s*${escaped}\\b`,
        );
        const idRe = new RegExp(`^(?:s\\s*)?${escaped}$`, "i");
        for (const row of candidates.rows) {
          const sid = String(row.section_id ?? "");
          if (idRe.test(sid) || markerRe.test(String(row.content ?? ""))) {
            sectionRef = sid;
            break;
          }
        }
      }
    }

    const jur = citationJurisdiction(doc.jurisdiction);
    const verifiedRef =
      `${doc.title}${jur ? ` (${jur})` : ""}` + (parsed.section && sectionRef ? ` s ${parsed.section}` : "");
    const inForce = doc.repealed_date ? false : doc.in_force_date ? true : null;

    return withCors(
      NextResponse.json({
        resolved: true,
        docId,
        docType: String(doc.doc_type ?? "act"),
        sectionRef,
        canonicalTitle: doc.title,
        verifiedRef,
        inForce,
        matchTier: bestLegTier,
        jurisdiction: doc.jurisdiction ?? null,
        source: "legislation",
        free: true,
      })
    );
  }

  // ── 2. Topics — exact-title-first, designation-aware ─────────────────────
  // Topic titles are claim sentences ("Privacy Act 1988 (Cth) establishes
  // 13 Australian Privacy Principles…"), so the citation is typically a
  // near-exact PREFIX. Standards citations ("AS/NZS 4308:2008") also match
  // by canonical designation prefix. Deterministic pick among plural claim
  // nodes: institutional tier first, then locked > consensus > open, then
  // oldest — never a fuzzy guess (every candidate must still pass the
  // titleMatchTier / designation-prefix verification).
  const topicPatterns = [`${escapeLike(nameLower)}%`];
  for (const d of designations) topicPatterns.push(`${escapeLike(d.canonical)}%`);
  const topicConds = topicPatterns.map(() => "LOWER(title) LIKE ?").join(" OR ");
  const topicArgs: unknown[] = [...topicPatterns];
  const topicResult = await db.execute({
    sql: `SELECT id, title, tier, status, jurisdiction, source_ref
          FROM topics
          WHERE ${topicConds}
          ORDER BY
            CASE tier WHEN 'institutional' THEN 0 ELSE 1 END,
            CASE status WHEN 'locked' THEN 0 WHEN 'consensus' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
            created_at ASC
          LIMIT 10`,
    args: topicArgs,
  });

  for (const row of topicResult.rows) {
    const title = String(row.title ?? "");
    const tier = titleMatchTier(parsed.name, title);
    const designationHit = designations.some((d) => title.toLowerCase().startsWith(d.canonical));
    if (tier === "none" && !designationHit) continue;
    if (!jurisdictionMatches(row.jurisdiction, parsed.jurisdiction)) continue;

    return withCors(
      NextResponse.json({
        resolved: true,
        docId: `topic:${row.id}`,
        docType: "topic",
        sectionRef: null,
        canonicalTitle: title,
        verifiedRef: String(row.source_ref ?? "") || title,
        inForce: null,
        matchTier: tier === "none" ? "near-exact" : tier,
        jurisdiction: row.jurisdiction ?? null,
        source: "topic",
        free: true,
      })
    );
  }

  // ── 3. Miss — never a fuzzy guess ─────────────────────────────────────────
  return withCors(
    NextResponse.json(
      {
        resolved: false,
        error: "citation_not_resolved",
        citation,
        parsed,
        hint:
          "No exact or near-exact title match in legislation_docs or topics. " +
          "Try /api/axiom/legislation/search?q=... for fuzzy full-text search.",
      },
      { status: 404 }
    )
  );
}
