export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// CORS — curriculum is free, unauthenticated, GET-only public data, designed to
// be read browser-side from other origins (the Spark PLG at spark.tailor.au
// resolves step-2 topics from here cross-origin). No credentials, so `*` is the
// correct, safe allow-origin. (#2609 — without this the browser blocks the
// cross-origin fetch and the PLG silently falls back to its curated topic map.)
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

// Preflight (sent by browsers for non-simple requests). A simple GET with
// `Accept: application/json` won't preflight, but handle OPTIONS for hygiene.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET /api/curriculum — Authoritative Australian curriculum descriptors (#2520)
//
// Free, unauthenticated. Australian curriculum (ACARA v9 / EYLF) is a public
// good — same posture as the legislation API (/api/axiom/legislation).
//
// Each descriptor is a real authoritative node: code (e.g. "AC9E3LE05",
// "EYLF-LO1") + verbatim descriptor text + source_ref back to the public
// government framework. Shape mirrors the legislation graph (doc → section);
// here it is framework → descriptor.
//
// Query params:
//   level      — Schooling band: "F" (Foundation), "1".."10", or "EL"
//                (Early Learning / EYLF). Accepts friendly aliases:
//                "foundation"→F, "year3"/"y3"/"3"→3, "el"/"early-learning"→EL.
//   subject    — Filter by PLG SubjectKind: "English", "Maths", "Science",
//                "HASS", "Health", "DigiTech", "Play". Case-insensitive.
//   framework  — "acara-v9" | "eylf-v2"
//   q          — keyword search across title + descriptor + code
//   limit/offset — pagination (limit max 200, default 100)
//
// Response:
//   { curriculum: [...], levels: [...available], total, limit, offset,
//     free: true, _links }
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const rawLevel = searchParams.get("level");
  const subject = searchParams.get("subject");
  const framework = searchParams.get("framework");
  const search = searchParams.get("q");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10) || 100, 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

  const level = normaliseLevel(rawLevel);

  const db = await getDb();

  let where = "1=1";
  const args: unknown[] = [];

  if (level) {
    where += " AND level = ?";
    args.push(level);
  }
  if (subject) {
    // Stored subject is the PLG SubjectKind ("English", "Maths", ...). Match
    // case-insensitively so callers can pass "maths" or "Maths".
    where += " AND LOWER(subject) = ?";
    args.push(subject.toLowerCase());
  }
  if (framework) {
    where += " AND framework_id = ?";
    args.push(framework.toLowerCase());
  }
  if (search) {
    where += " AND (title LIKE ? OR descriptor LIKE ? OR code LIKE ?)";
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Count total matching the filter (for pagination metadata).
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM curriculum_descriptors WHERE ${where}`,
    args,
  });
  const total = (countResult.rows[0]?.total as number) || 0;

  // Fetch the page, joining the framework for citation metadata.
  const rows = await db.execute({
    sql: `SELECT d.id, d.framework_id, d.code, d.level, d.level_name, d.subject,
                 d.learning_area, d.strand, d.title, d.descriptor, d.blurb,
                 d.source_ref, d.source_url, d.sort_order,
                 f.name AS framework_name, f.short_name AS framework_short,
                 f.authority AS framework_authority, f.version AS framework_version
          FROM curriculum_descriptors d
          JOIN curriculum_frameworks f ON f.id = d.framework_id
          WHERE ${where}
          ORDER BY d.level ASC, d.subject ASC, d.sort_order ASC, d.code ASC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  const curriculum = rows.rows.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    level: r.level as string,
    levelName: (r.level_name as string) || null,
    subject: r.subject as string,
    learningArea: (r.learning_area as string) || null,
    strand: (r.strand as string) || null,
    title: (r.title as string) || null,
    descriptor: r.descriptor as string,
    blurb: (r.blurb as string) || null,
    sourceRef: (r.source_ref as string) || null,
    sourceUrl: (r.source_url as string) || null,
    framework: {
      id: r.framework_id as string,
      name: r.framework_name as string,
      shortName: (r.framework_short as string) || null,
      authority: (r.framework_authority as string) || null,
      version: (r.framework_version as string) || null,
    },
  }));

  // Available levels (handy for clients building grade pickers).
  const levelsResult = await db.execute({
    sql: `SELECT DISTINCT level, level_name FROM curriculum_descriptors ORDER BY level ASC`,
    args: [],
  });
  const levels = levelsResult.rows.map((r) => ({
    level: r.level as string,
    levelName: (r.level_name as string) || null,
  }));

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (rawLevel) p.set("level", rawLevel);
    if (subject) p.set("subject", subject);
    if (framework) p.set("framework", framework);
    if (search) p.set("q", search);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  };

  return NextResponse.json(
    {
      curriculum,
      levels,
      total,
      limit,
      offset,
      free: true,
      _links: {
        self: `/api/curriculum?${qs({ limit, offset })}`,
        next: offset + limit < total ? `/api/curriculum?${qs({ limit, offset: offset + limit })}` : null,
      },
    },
    {
      headers: {
        ...CORS_HEADERS,
        // Curriculum is authoritative + slow-changing — cache like legislation.
        "Cache-Control": "public, max-age=86400",
        "X-Total-Results": String(total),
      },
    },
  );
}

// Accept friendly level aliases so the PLG can pass either the canonical band
// ("F", "3", "EL") or a friendlier label.
function normaliseLevel(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "f" || s === "foundation") return "F";
  if (s === "el" || s === "early-learning" || s === "early learning" || s === "eylf") return "EL";
  const yearMatch = s.match(/^(?:year[\s-]?|y)?(\d{1,2})$/);
  if (yearMatch) return yearMatch[1];
  return raw.trim().toUpperCase();
}
