"use client";

// Federated legislation + topic search UI.
//
// Wraps `/api/axiom/legislation/search` (full-text, cross-jurisdictional,
// includes topic-tier hits). URL is the source of truth — every filter and
// the pagination offset live as query-string params, so deep-links work
// from agents, share buttons, audit trails, and the API endpoint's redirect
// path (browser users hitting `/api/axiom/legislation/search` get bounced
// here via 303 — see route.ts).
//
// Migration: #1360 / MEGA-80 follow-up — closes the federated-search UX gap.
// Until this page existed the federated search was JSON-only; browsers
// landing on the API URL got a wall of JSON. This is the human-facing
// surface; the API URL stays for agents.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WARRANT_KINDS } from "@/lib/epistemic";
import {
  WarrantBadge,
  StatePill,
  CredenceBar,
  ConventionStopFlag,
} from "@/components/claim-tokens";

const JURISDICTIONS = ["All", "QLD", "NSW", "CTH"] as const;
const DOC_TYPES = ["All", "act", "regulation", "standard", "guidance"] as const;
const STATUSES = ["All", "in_force", "repealed", "not_yet_commenced"] as const;

// ── Lexicon facets (#3724, dual-axis epistemic model) ────────────────
// Type = warrant kind (Axis A, four UNORDERED peers), State + Credence =
// Axis B. All compose via URL search params alongside the legislation
// facets above.
const WARRANT_FACETS = ["All", ...WARRANT_KINDS] as const;
const STATE_FACETS = ["All", "open", "contested", "aligned", "verified"] as const;
const CREDENCE_FACETS = [
  { label: "Any", value: "" },
  { label: "≥0.5", value: "0.5" },
  { label: "≥0.8", value: "0.8" },
] as const;
const PAGE_SIZE = 25;
const MAX_CONTENT_PREVIEW = 280;

type Jurisdiction = (typeof JURISDICTIONS)[number];
type DocType = (typeof DOC_TYPES)[number];
type Status = (typeof STATUSES)[number];

interface SearchHit {
  docId: string;
  docTitle: string;
  jurisdiction: string;
  docType: string;
  year: number | null;
  sectionId: string;
  sectionTitle: string | null;
  content: string;
  depth: number;
  status: string;
  relevanceScore: number;
  crossReferences: string[];
  sourceRef: string | null;
}

interface SearchResponse {
  results: SearchHit[];
  query: string;
  keywords: string[];
  total: number;
  sources: { legislation: number; topics: number };
  limit: number;
  offset: number;
  free: boolean;
  ranking: {
    preferJurisdiction: string | null;
    defaultAuBias: boolean;
    titleMatch: string;
  };
  _links: { self: string; next: string | null; html?: string };
  error?: string;
}

interface SearchErrorResponse {
  error: string;
  example?: string;
}

// Enriched topic row from GET /api/pact/topics — carries the dual-axis
// fields (warrantKind / state / credence / conventionStop) alongside the
// legacy tier/status.
interface TopicClaim {
  id: string;
  title: string;
  warrantKind: string;
  state: string;
  credence: number | null;
  conventionStop: boolean;
  canonical_claim: string | null;
  jurisdiction: string | null;
  participantCount: number;
}

const JURISDICTION_COLOR: Record<string, string> = {
  CTH: "text-pact-cyan border-pact-cyan/30",
  QLD: "text-pact-purple border-pact-purple/30",
  NSW: "text-green-600 border-green-500/30",
  AU: "text-pact-cyan border-pact-cyan/30",
};

function jurisdictionBadge(jurisdiction: string): { text: string; border: string } {
  const entry = JURISDICTION_COLOR[jurisdiction] ?? "text-foreground border-card-border";
  const [text, border] = entry.split(" ");
  return { text, border };
}

function isTopicHit(hit: SearchHit): boolean {
  return hit.docType === "topic" || hit.docId.startsWith("topic:");
}

function trimContent(content: string): string {
  if (content.length <= MAX_CONTENT_PREVIEW) return content;
  // Trim at a word boundary just before MAX_CONTENT_PREVIEW.
  const slice = content.slice(0, MAX_CONTENT_PREVIEW);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > MAX_CONTENT_PREVIEW * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut + "…";
}

function highlightKeywords(text: string, keywords: string[]): string {
  // Strip HTML entities the API returns (e.g. &mdash;, &nbsp;) so we don't
  // confuse them with real ampersands. The API returns raw section content
  // which can include legacy entity escapes from upstream OCR.
  return text.replace(/&[a-z]+;|&#\d+;/gi, " ");
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  const urlJurisdiction = (searchParams.get("jurisdiction") ?? "All") as Jurisdiction;
  const urlDocType = (searchParams.get("type") ?? "All") as DocType;
  const urlStatus = (searchParams.get("status") ?? "All") as Status;
  const urlPreferJurisdiction = searchParams.get("preferJurisdiction") ?? "";
  const urlOffset = parseInt(searchParams.get("offset") ?? "0", 10) || 0;

  // Lexicon facets (dual-axis) — compose via URL search params.
  const urlWarrant = (searchParams.get("warrant") ?? "All") as (typeof WARRANT_FACETS)[number];
  const urlState = (searchParams.get("state") ?? "All") as (typeof STATE_FACETS)[number];
  const urlMinCredence = searchParams.get("minCredence") ?? "";

  const [query, setQuery] = useState(urlQuery);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<TopicClaim[] | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);

  // Sync local query state when URL changes (e.g. browser back).
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  // Push URL updates when filters change (debounced via searchparam round-trip).
  const updateUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === "All") next.delete(k);
        else next.set(k, v);
      }
      // Reset offset on any non-offset filter change so users don't get stuck
      // on an empty page after narrowing the filter set.
      if (!("offset" in patch)) next.delete("offset");
      router.replace(`/search?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Fetch search results when the URL changes.
  const lastFetchKey = useRef<string | null>(null);
  useEffect(() => {
    if (!urlQuery.trim()) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const apiParams = new URLSearchParams();
    apiParams.set("q", urlQuery.trim());
    if (urlJurisdiction !== "All") apiParams.set("jurisdiction", urlJurisdiction);
    if (urlDocType !== "All") apiParams.set("type", urlDocType);
    if (urlStatus !== "All") apiParams.set("status", urlStatus);
    if (urlPreferJurisdiction) apiParams.set("preferJurisdiction", urlPreferJurisdiction);
    apiParams.set("limit", String(PAGE_SIZE));
    apiParams.set("offset", String(urlOffset));

    const fetchKey = apiParams.toString();
    if (lastFetchKey.current === fetchKey) return; // Avoid double-fetch on remount.
    lastFetchKey.current = fetchKey;

    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    fetch(`/api/axiom/legislation/search?${apiParams}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as SearchResponse | SearchErrorResponse;
        if (!res.ok) {
          throw new Error(body.error ?? `Search failed (${res.status})`);
        }
        setData(body as SearchResponse);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setData(null);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [urlQuery, urlJurisdiction, urlDocType, urlStatus, urlPreferJurisdiction, urlOffset]);

  // Fetch topic claims from the dual-axis lexicon (/api/pact/topics) when a
  // query or any lexicon facet is active. Warrant filters server-side via
  // ?warrant=; state + credence compose client-side over the enriched rows.
  const lexiconActive =
    !!urlQuery.trim() || urlWarrant !== "All" || urlState !== "All" || !!urlMinCredence;
  useEffect(() => {
    if (!lexiconActive) {
      setClaims(null);
      setClaimsLoading(false);
      return;
    }
    const apiParams = new URLSearchParams();
    if (urlQuery.trim()) apiParams.set("q", urlQuery.trim());
    if (urlWarrant !== "All") apiParams.set("warrant", urlWarrant);
    apiParams.set("limit", "100");

    setClaimsLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/pact/topics?${apiParams}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Topics lookup failed (${res.status})`);
        const rows = (await res.json()) as TopicClaim[];
        const minCredence = parseFloat(urlMinCredence);
        setClaims(
          rows
            .filter((t) => (urlState !== "All" ? t.state === urlState : true))
            .filter((t) =>
              Number.isFinite(minCredence) && urlMinCredence
                ? (t.credence ?? 0) >= minCredence
                : true
            )
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setClaims(null); // Lexicon lookup is best-effort; legislation search still renders.
      })
      .finally(() => setClaimsLoading(false));

    return () => ctrl.abort();
  }, [lexiconActive, urlQuery, urlWarrant, urlState, urlMinCredence]);

  // Submit handler — push the typed query into the URL.
  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      updateUrl({ q: query.trim() || null });
    },
    [query, updateUrl]
  );

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1),
    [data]
  );
  const currentPage = useMemo(() => Math.floor(urlOffset / PAGE_SIZE) + 1, [urlOffset]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/" className="text-pact-dim text-xs hover:text-pact-cyan mb-6 block">
        &larr; Back to Source
      </Link>

      <h1 className="text-3xl font-bold mb-2">Search Source</h1>
      <p className="text-pact-dim text-sm mb-6">
        Federated full-text search across Australian legislation (CTH, QLD, NSW)
        and Source topics. Free for anonymous use. Agents pay 1 credit per call
        with an <code className="text-pact-cyan">x-source-agent-key</code> header.
      </p>

      <form onSubmit={onSubmit} className="mb-6">
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search e.g. "PMBOK Guide", "duty of care", "DFARS"'
            className="flex-1 min-w-[260px] px-4 py-2 bg-background border border-card-border rounded-lg text-sm focus:outline-none focus:border-pact-cyan"
            aria-label="Search query"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-pact-cyan text-background font-bold rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={!query.trim() || loading}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <FilterPill
          label="Jurisdiction"
          options={JURISDICTIONS as readonly string[]}
          value={urlJurisdiction}
          onChange={(v) => updateUrl({ jurisdiction: v === "All" ? null : v })}
        />
        <FilterPill
          label="Type"
          options={DOC_TYPES as readonly string[]}
          value={urlDocType}
          onChange={(v) => updateUrl({ type: v === "All" ? null : v })}
        />
        <FilterPill
          label="Status"
          options={STATUSES as readonly string[]}
          value={urlStatus}
          onChange={(v) => updateUrl({ status: v === "All" ? null : v })}
        />
      </div>

      {/* ── Lexicon facets (dual-axis): warrant kind is a row of four
             unordered PEERS, state is the consensus lifecycle, credence
             is asymptotic (never 1.0) ── */}
      <div className="flex flex-wrap gap-2 mb-8 text-xs">
        <FilterPill
          label="Warrant"
          options={WARRANT_FACETS as readonly string[]}
          value={urlWarrant}
          onChange={(v) => updateUrl({ warrant: v === "All" ? null : v })}
        />
        <FilterPill
          label="State"
          options={STATE_FACETS as readonly string[]}
          value={urlState}
          onChange={(v) => updateUrl({ state: v === "All" ? null : v })}
        />
        <div className="flex items-center gap-2">
          <span className="text-pact-dim">Credence:</span>
          <div className="flex items-center bg-background/80 border border-card-border rounded-full p-0.5">
            {CREDENCE_FACETS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => updateUrl({ minCredence: opt.value || null })}
                className={`px-3 py-1 rounded-full transition-all ${
                  urlMinCredence === opt.value
                    ? "bg-pact-cyan text-background font-bold"
                    : "text-pact-dim hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Claim (topic) results from the lexicon — rendered above the
          federated legislation hits when the lexicon facets are active */}
      {lexiconActive && (claimsLoading || (claims && claims.length > 0)) && (
        <div className="mb-8">
          <p className="text-xs text-pact-dim mb-3">
            {claimsLoading
              ? "Searching claims…"
              : `${claims!.length} claim${claims!.length === 1 ? "" : "s"} in the lexicon`}
          </p>
          {!claimsLoading && claims && (
            <div className="space-y-2">
              {claims.slice(0, 20).map((c) => (
                <Link
                  key={c.id}
                  href={`/topics/${encodeURIComponent(c.id)}`}
                  className="block bg-card-bg border border-card-border rounded-xl px-5 py-3 hover:border-pact-cyan/30 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <WarrantBadge kind={c.warrantKind} size="xs" />
                    <StatePill state={c.state} size="xs" />
                    <CredenceBar value={c.credence} compact />
                    <ConventionStopFlag value={c.conventionStop} size="xs" />
                    {c.jurisdiction && (
                      <span className="text-[9px] px-1.5 py-px rounded border border-amber-400/30 text-amber-400">
                        {c.jurisdiction}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium">{c.title}</div>
                  {c.canonical_claim && (
                    <p className="text-xs text-pact-dim font-mono truncate mt-0.5">{c.canonical_claim}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {!urlQuery.trim() ? (
        <EmptyPrompt />
      ) : loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => updateUrl({})} />
      ) : !data || data.results.length === 0 ? (
        <NoResults query={urlQuery} />
      ) : (
        <ResultsList data={data} keywords={data.keywords} />
      )}

      {data && data.results.length > 0 && data.total > PAGE_SIZE && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          offset={urlOffset}
          total={data.total}
          pageSize={PAGE_SIZE}
          onPrev={() =>
            updateUrl({ offset: urlOffset > 0 ? String(Math.max(0, urlOffset - PAGE_SIZE)) : null })
          }
          onNext={() => updateUrl({ offset: String(urlOffset + PAGE_SIZE) })}
        />
      )}

      <ApiHint query={urlQuery} apiSelf={data?._links.self ?? null} />
    </div>
  );
}

function FilterPill({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-pact-dim">{label}:</span>
      <div className="flex items-center bg-background/80 border border-card-border rounded-full p-0.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1 rounded-full transition-all ${
              value === opt
                ? "bg-pact-cyan text-background font-bold"
                : "text-pact-dim hover:text-foreground"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyPrompt() {
  return (
    <div className="text-center py-20 text-pact-dim text-sm">
      <p className="mb-2">Type a query above to search Source.</p>
      <p className="text-xs">
        Tip: queries are tokenised; you need at least one word with 3+ characters.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-card-bg border border-card-border rounded-xl px-5 py-4 animate-pulse"
        >
          <div className="h-3 w-24 bg-pact-dim/20 rounded mb-2"></div>
          <div className="h-4 w-3/4 bg-pact-dim/20 rounded mb-3"></div>
          <div className="h-3 w-full bg-pact-dim/10 rounded mb-1"></div>
          <div className="h-3 w-5/6 bg-pact-dim/10 rounded"></div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-20">
      <p className="text-pact-orange text-sm mb-3">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs text-pact-cyan hover:underline"
      >
        Retry &rarr;
      </button>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="text-center py-20 text-pact-dim text-sm">
      <p className="mb-2">
        No results for <span className="text-foreground font-mono">&quot;{query}&quot;</span>.
      </p>
      <p className="text-xs">Try broadening filters above or different keywords.</p>
    </div>
  );
}

function ResultsList({ data, keywords }: { data: SearchResponse; keywords: string[] }) {
  return (
    <div>
      <p className="text-xs text-pact-dim mb-4">
        {data.total} result{data.total === 1 ? "" : "s"} —{" "}
        {data.sources.legislation} legislation, {data.sources.topics} topic
        {data.sources.topics === 1 ? "" : "s"}
        {data.ranking.preferJurisdiction && (
          <span> · Prefer {data.ranking.preferJurisdiction}</span>
        )}
        {data.ranking.defaultAuBias && !data.ranking.preferJurisdiction && (
          <span> · Default AU bias</span>
        )}
      </p>
      <div className="space-y-3">
        {data.results.map((hit, idx) => (
          <ResultCard key={`${hit.docId}:${hit.sectionId}:${idx}`} hit={hit} keywords={keywords} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ hit, keywords }: { hit: SearchHit; keywords: string[] }) {
  const isTopic = isTopicHit(hit);
  const badge = jurisdictionBadge(hit.jurisdiction);
  const previewContent = trimContent(highlightKeywords(hit.content, keywords));

  // Build a deep-link target. Topics → /topics/[id]. Legislation sections →
  // /legislation (no per-section page yet — anchor by docId + sectionId).
  const deepLinkHref = isTopic
    ? `/topics/${encodeURIComponent(hit.docId.replace(/^topic:/, ""))}`
    : `/legislation?q=${encodeURIComponent(hit.docTitle)}`;

  return (
    <article className={`bg-card-bg border ${badge.border} rounded-xl px-5 py-4`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className={`font-bold uppercase tracking-wider ${badge.text}`}>
            {hit.jurisdiction}
          </span>
          <span className="text-pact-dim">{hit.docType}</span>
          {hit.year && <span className="text-pact-dim">{hit.year}</span>}
          {isTopic && (
            <span className="px-1.5 py-0.5 rounded bg-pact-purple/20 text-pact-purple uppercase tracking-wider font-bold">
              Topic
            </span>
          )}
          {hit.status && hit.status !== "in_force" && (
            <span className="px-1.5 py-0.5 rounded bg-pact-orange/20 text-pact-orange uppercase tracking-wider font-bold">
              {hit.status}
            </span>
          )}
        </div>
        {hit.relevanceScore > 0 && (
          <span className="text-[10px] text-pact-dim shrink-0" title="Relevance score">
            score {hit.relevanceScore.toFixed(2)}
          </span>
        )}
      </div>

      <h2 className="font-bold text-sm mb-1">{hit.docTitle}</h2>
      {hit.sectionTitle && (
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-pact-cyan font-mono text-xs">{hit.sectionId}</span>
          <span className="text-xs font-medium">{hit.sectionTitle}</span>
        </div>
      )}

      <p className="text-xs text-pact-dim leading-relaxed whitespace-pre-wrap mb-3">
        {previewContent}
      </p>

      <div className="flex items-center justify-between gap-3 text-[10px]">
        <div className="text-pact-dim min-w-0 truncate">
          {hit.sourceRef && <span className="font-mono">{hit.sourceRef}</span>}
        </div>
        <Link
          href={deepLinkHref}
          className="text-pact-cyan hover:underline shrink-0"
        >
          {isTopic ? "View topic" : "View in legislation"} &rarr;
        </Link>
      </div>

      {hit.crossReferences.length > 0 && (
        <div className="mt-2 pt-2 border-t border-card-border/50 text-[10px] text-pact-dim">
          See also: {hit.crossReferences.join(", ")}
        </div>
      )}
    </article>
  );
}

function Pagination({
  currentPage,
  totalPages,
  offset,
  total,
  pageSize,
  onPrev,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  offset: number;
  total: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + pageSize, total);
  return (
    <nav className="flex items-center justify-between gap-3 mt-8 pt-5 border-t border-card-border" aria-label="Pagination">
      <button
        type="button"
        onClick={onPrev}
        disabled={offset === 0}
        className="text-xs text-pact-cyan hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
      >
        &larr; Previous
      </button>
      <span className="text-xs text-pact-dim">
        Showing {showingFrom}–{showingTo} of {total} (page {currentPage} of {totalPages})
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={currentPage >= totalPages}
        className="text-xs text-pact-cyan hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
      >
        Next &rarr;
      </button>
    </nav>
  );
}

function ApiHint({ query, apiSelf }: { query: string; apiSelf: string | null }) {
  const apiUrl = apiSelf ?? (query
    ? `/api/axiom/legislation/search?q=${encodeURIComponent(query)}`
    : `/api/axiom/legislation/search?q=...`);
  return (
    <div className="mt-10 bg-card-bg border border-card-border rounded-xl p-5">
      <p className="text-xs text-pact-dim mb-2">Want machine-readable access?</p>
      <code className="text-xs text-pact-cyan bg-background px-3 py-1.5 rounded block break-all">
        GET https://pact.tailor.au{apiUrl}
      </code>
      <div className="flex items-center gap-4 mt-2">
        <Link href="/axiom" className="text-xs text-pact-cyan hover:underline">
          API Reference &rarr;
        </Link>
        <Link href="/legislation" className="text-xs text-pact-cyan hover:underline">
          Browse legislation by jurisdiction &rarr;
        </Link>
      </div>
    </div>
  );
}

export default function SearchPage() {
  // Suspense wrapper required for useSearchParams() in Next.js App Router.
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <SearchPageInner />
    </Suspense>
  );
}
