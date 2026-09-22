export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordAudit, ipCountryFromHeaders } from "@/lib/audit";
import { requireAdmin } from "@/lib/admin-auth";
import { readBodyBounded, ADMIN_INGEST_MAX_BODY_BYTES } from "@/lib/read-body-bounded";

// POST /api/curriculum/ingest — Bulk-ingest authoritative curriculum descriptors (#2520)
//
// Admin endpoint for trusted, authoritative curriculum ingestion. Like the
// legislation ingest route, it bypasses the PACT consensus flow because
// curriculum is authoritative by definition (it comes from ACARA / the
// Education Ministers, not from debate). Use it to bulk-load grades beyond the
// seeded Foundation/Year 3/Year 6 + EYLF slice as the pattern expands.
//
// Body:
// {
//   "frameworks": [{                          // optional — upserts framework rows
//     "id": "acara-v9",
//     "name": "Australian Curriculum Version 9.0",
//     "shortName": "ACARA v9",
//     "authority": "ACARA",
//     "jurisdiction": "AU",
//     "version": "9.0",
//     "frameworkUrl": "https://v9.australiancurriculum.edu.au"
//   }],
//   "descriptors": [{
//     "frameworkId": "acara-v9",
//     "code": "AC9E5LY06",                    // REAL authoritative code (required)
//     "level": "5",                           // "F" | "1".."10" | "EL"
//     "levelName": "Year 5",
//     "subject": "English",                   // PLG SubjectKind
//     "learningArea": "English",
//     "strand": "Literacy — Creating texts",
//     "title": "…",
//     "descriptor": "…verbatim public text…", // required
//     "blurb": "…short gloss…",
//     "sourceRef": "ACARA Australian Curriculum v9.0 — English, Year 5",
//     "sourceUrl": "https://v9.australiancurriculum.edu.au/…"
//   }]
// }
//
// Auth: X-Admin-Key header must equal ADMIN_SECRET (same gate as legislation).
export async function POST(req: NextRequest) {
  // Admin auth — shared timing-safe middleware (#2881)
  const denied = requireAdmin(req);
  if (denied) return denied;

  const bounded = await readBodyBounded(req, ADMIN_INGEST_MAX_BODY_BYTES);
  if (!bounded.ok) return bounded.response;
  const body = JSON.parse(bounded.text);
  const frameworks = Array.isArray(body.frameworks) ? body.frameworks : [];
  const descriptors = body.descriptors;
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return NextResponse.json({ error: "Body must contain a non-empty 'descriptors' array." }, { status: 400 });
  }

  const db = await getDb();

  // Upsert frameworks first so descriptor FKs resolve.
  for (const fw of frameworks) {
    if (!fw?.id || !fw?.name) continue;
    await db.execute({
      sql: `INSERT INTO curriculum_frameworks (id, name, short_name, authority, jurisdiction, version, framework_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
              name = excluded.name,
              short_name = excluded.short_name,
              authority = excluded.authority,
              version = excluded.version,
              framework_url = excluded.framework_url`,
      args: [
        fw.id,
        fw.name,
        fw.shortName || null,
        fw.authority || null,
        (fw.jurisdiction || "AU").toUpperCase(),
        fw.version || null,
        fw.frameworkUrl || null,
      ],
    });
  }

  let inserted = 0;
  let skipped = 0;
  const rejected: { index: number; reason: string }[] = [];

  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i];
    // Honesty guard: a descriptor MUST carry a real code + text. Refuse rows
    // that omit either rather than fabricate placeholders.
    if (!d?.frameworkId || !d?.code || !d?.descriptor || !d?.level || !d?.subject) {
      rejected.push({ index: i, reason: "missing required field (frameworkId, code, level, subject, descriptor)" });
      continue;
    }
    const id = `${d.frameworkId}/${d.code}`;
    const result = await db.execute({
      sql: `INSERT INTO curriculum_descriptors
              (id, framework_id, code, level, level_name, subject, learning_area,
               strand, title, descriptor, blurb, source_ref, source_url, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (framework_id, code) DO UPDATE SET
              level = excluded.level,
              level_name = excluded.level_name,
              subject = excluded.subject,
              learning_area = excluded.learning_area,
              strand = excluded.strand,
              title = excluded.title,
              descriptor = excluded.descriptor,
              blurb = excluded.blurb,
              source_ref = excluded.source_ref,
              source_url = excluded.source_url`,
      args: [
        id,
        d.frameworkId,
        d.code,
        String(d.level),
        d.levelName || null,
        d.subject,
        d.learningArea || null,
        d.strand || null,
        d.title || null,
        d.descriptor,
        d.blurb || null,
        d.sourceRef || null,
        d.sourceUrl || null,
        typeof d.sortOrder === "number" ? d.sortOrder : i,
      ],
    });
    if ((result.rowsAffected ?? 0) > 0) inserted++;
    else skipped++;
  }

  await recordAudit({
    actorKey: null,
    actorLabel: "admin",
    op: "curriculum.ingest",
    entityType: "curriculum_batch",
    entityId: descriptors[0]?.code ?? null,
    before: null,
    after: { inserted, skipped, rejected: rejected.length, total: descriptors.length },
    requestId: req.headers.get("x-request-id"),
    ipCountry: ipCountryFromHeaders(req.headers),
  });

  return NextResponse.json({
    inserted,
    skipped,
    rejected,
    message: `Ingested ${inserted} curriculum descriptor(s) (${skipped} unchanged, ${rejected.length} rejected).`,
  });
}
