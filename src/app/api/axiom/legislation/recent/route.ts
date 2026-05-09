export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/axiom/legislation/recent — Recently amended legislation
//
// Free, unauthenticated. Australian legislation is a public good.
//
// "Recent" = last_amended_date within the last N days (default 30, max 365).
//
// Query params:
//   days          — Window size in days (1..365, default 30)
//   limit         — Pagination limit (1..200, default 50)
//   offset        — Pagination offset (default 0)
//   jurisdiction  — Filter (prefix match: "QLD" matches "QLD", "AU-QLD" matches "AU"+"AU-QLD-…")
//
// Response shape:
//   { legislation: [...], total, daysWindow, since, limit, offset, free: true, _links }
//
// Note: last_amended_date is stored as ISO TEXT (e.g. "2024-12-01"); ISO date
// strings sort correctly as text, so "WHERE last_amended_date >= ?" with the
// cutoff string works without TIMESTAMPTZ migration.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10) || 30));
  const limit = Math.max(1, Math.min(200, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);
  const jurisdiction = searchParams.get("jurisdiction");

  // Compute ISO cutoff date in UTC: NOW - days
  const cutoff = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  const db = await getDb();

  let where = "last_amended_date IS NOT NULL AND last_amended_date >= ?";
  const args: unknown[] = [cutoff];

  if (jurisdiction) {
    where += " AND (jurisdiction = ? OR jurisdiction LIKE ? || '-%')";
    args.push(jurisdiction.toUpperCase(), jurisdiction.toUpperCase());
  }

  // Count total in window
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM legislation_docs WHERE ${where}`,
    args,
  });
  const total = (countResult.rows[0]?.total as number) || 0;

  // Fetch the page
  const docsResult = await db.execute({
    sql: `SELECT id, jurisdiction, doc_type, title, short_title, year, number,
                 in_force_date, last_amended_date, repealed_date,
                 administered_by, legislation_url
          FROM legislation_docs
          WHERE ${where}
          ORDER BY last_amended_date DESC NULLS LAST, jurisdiction ASC, title ASC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  const legislation = docsResult.rows.map((row) => ({
    id: row.id as string,
    jurisdiction: row.jurisdiction as string,
    type: row.doc_type as string,
    title: row.title as string,
    shortTitle: (row.short_title as string) || null,
    year: (row.year as number) || null,
    number: (row.number as string) || null,
    inForceDate: (row.in_force_date as string) || null,
    lastAmendedDate: (row.last_amended_date as string) || null,
    repealedDate: (row.repealed_date as string) || null,
    administeredBy: (row.administered_by as string) || null,
    legislationUrl: (row.legislation_url as string) || null,
    _links: {
      self: `/api/axiom/legislation/${encodeURIComponent(row.id as string)}`,
      html: `/legislation/${encodeURIComponent(row.id as string)}`,
    },
  }));

  return NextResponse.json({
    legislation,
    total,
    daysWindow: days,
    since: cutoff,
    limit,
    offset,
    free: true,
    _links: {
      self: `/api/axiom/legislation/recent?days=${days}&limit=${limit}&offset=${offset}${jurisdiction ? `&jurisdiction=${encodeURIComponent(jurisdiction)}` : ""}`,
      next: offset + limit < total
        ? `/api/axiom/legislation/recent?days=${days}&limit=${limit}&offset=${offset + limit}${jurisdiction ? `&jurisdiction=${encodeURIComponent(jurisdiction)}` : ""}`
        : null,
      html: `/legislation/recent?days=${days}${jurisdiction ? `&jurisdiction=${encodeURIComponent(jurisdiction)}` : ""}`,
    },
  });
}
