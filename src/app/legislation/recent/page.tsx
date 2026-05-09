import Link from "next/link";
import { getDb } from "@/lib/db";

export const revalidate = 60;

export const metadata = {
  title: "Recently amended legislation — Source",
  description: "Australian legislation amended in the last N days. Free API.",
};

const ALLOWED_DAYS = [7, 14, 30, 60, 90, 180, 365];
const ALLOWED_JURISDICTIONS = ["", "CTH", "QLD", "NSW", "VIC", "WA", "SA", "TAS", "ACT", "NT"];

type RecentRow = {
  id: string;
  jurisdiction: string;
  doc_type: string;
  title: string;
  short_title: string | null;
  year: number | null;
  last_amended_date: string | null;
  legislation_url: string | null;
};

async function getRecent(
  days: number,
  jurisdiction: string | null,
): Promise<{ rows: RecentRow[]; cutoff: string }> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  let where = "last_amended_date IS NOT NULL AND last_amended_date >= ?";
  const args: unknown[] = [cutoff];

  if (jurisdiction) {
    where += " AND (jurisdiction = ? OR jurisdiction LIKE ? || '-%')";
    args.push(jurisdiction.toUpperCase(), jurisdiction.toUpperCase());
  }

  try {
    const db = await getDb();
    const r = await db.execute({
      sql: `SELECT id, jurisdiction, doc_type, title, short_title, year,
                   last_amended_date, legislation_url
            FROM legislation_docs
            WHERE ${where}
            ORDER BY last_amended_date DESC NULLS LAST, jurisdiction ASC, title ASC
            LIMIT 200`,
      args,
    });
    return { rows: r.rows as unknown as RecentRow[], cutoff };
  } catch {
    return { rows: [], cutoff };
  }
}

function relativeDays(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diffMs = nowMs - then;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 1) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 60) return "~1 month ago";
  if (diffDays < 365) return `~${Math.floor(diffDays / 30)} months ago`;
  return `~${Math.floor(diffDays / 365)} years ago`;
}

export default async function RecentLegislationPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; jurisdiction?: string }>;
}) {
  const params = await searchParams;
  const daysParam = parseInt(params.days || "30", 10) || 30;
  const days = ALLOWED_DAYS.includes(daysParam) ? daysParam : 30;
  const jurisdictionParam = (params.jurisdiction || "").toUpperCase();
  const jurisdiction = ALLOWED_JURISDICTIONS.includes(jurisdictionParam) ? jurisdictionParam : "";

  const { rows, cutoff } = await getRecent(days, jurisdiction || null);
  // Snapshot of "now" computed once so the component body stays pure.
  const nowMs = new Date(`${cutoff}T00:00:00Z`).getTime() + days * 86_400_000;

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
      <div className="mb-5">
        <h1 className="text-3xl font-bold mb-1">Recently amended legislation</h1>
        <p className="text-sm text-pact-dim max-w-2xl">
          Australian legislation amended on or after <span className="text-pact-cyan font-mono">{cutoff}</span>.
          Free API:{" "}
          <a
            href={`/api/axiom/legislation/recent?days=${days}${jurisdiction ? `&jurisdiction=${jurisdiction}` : ""}`}
            className="text-pact-cyan font-mono text-xs hover:underline"
          >
            /api/axiom/legislation/recent?days={days}
            {jurisdiction ? `&jurisdiction=${jurisdiction}` : ""}
          </a>
        </p>
      </div>

      {/* Filter chips — days window */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-xs text-pact-dim mr-1">Window:</span>
        {ALLOWED_DAYS.map((d) => (
          <Link
            key={d}
            href={`/legislation/recent?days=${d}${jurisdiction ? `&jurisdiction=${jurisdiction}` : ""}`}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              d === days
                ? "bg-pact-cyan/15 border-pact-cyan/40 text-pact-cyan"
                : "border-card-border text-pact-dim hover:text-foreground hover:bg-hover-bg"
            }`}
          >
            {d}d
          </Link>
        ))}
      </div>

      {/* Filter chips — jurisdiction */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6">
        <span className="text-xs text-pact-dim mr-1">Jurisdiction:</span>
        {ALLOWED_JURISDICTIONS.map((j) => {
          const label = j === "" ? "All" : j;
          const active = j === jurisdiction;
          const href = j === ""
            ? `/legislation/recent?days=${days}`
            : `/legislation/recent?days=${days}&jurisdiction=${j}`;
          return (
            <Link
              key={j || "all"}
              href={href}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                active
                  ? "bg-pact-purple/15 border-pact-purple/40 text-pact-purple"
                  : "border-card-border text-pact-dim hover:text-foreground hover:bg-hover-bg"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Results */}
      {rows.length === 0 ? (
        <div className="bg-card-bg border border-card-border rounded-lg p-8 text-center">
          <p className="text-sm text-pact-dim">
            No legislation amended in the last {days} days
            {jurisdiction ? ` for ${jurisdiction}` : ""}. Try a longer window.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-pact-dim mb-2">
            {rows.length} {rows.length === 1 ? "result" : "results"}
          </p>
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/legislation/${encodeURIComponent(row.id)}`}
              className="flex items-center gap-3 px-3 py-2 bg-card-bg border border-card-border rounded-lg hover:border-pact-cyan/40 hover:bg-hover-bg transition-colors group"
            >
              <span className="text-pact-cyan font-mono text-[10px] uppercase shrink-0 w-12">
                {row.jurisdiction}
              </span>
              <span className="text-foreground/80 group-hover:text-foreground flex-1 truncate text-sm">
                {row.short_title || row.title}
                {row.year && <span className="text-pact-dim/60 ml-1.5">({row.year})</span>}
              </span>
              <span className="text-pact-dim/60 font-mono text-[10px] shrink-0 w-24 text-right">
                {row.last_amended_date?.slice(0, 10) || "—"}
              </span>
              <span className="text-pact-dim/40 text-[10px] shrink-0 w-24 text-right hidden sm:inline">
                {relativeDays(row.last_amended_date, nowMs)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Footer link */}
      <div className="mt-8 text-center">
        <Link
          href="/legislation"
          className="text-xs text-pact-cyan/70 hover:text-pact-cyan transition-colors"
        >
          &larr; All legislation
        </Link>
      </div>
    </div>
  );
}
