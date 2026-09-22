"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

const JURISDICTIONS = ["All", "QLD", "NSW", "CTH"] as const;
type Jurisdiction = (typeof JURISDICTIONS)[number];

interface LegislationSection {
  sectionId: string;
  title: string | null;
  content: string;
  depth: number;
  status: string;
  crossReferences: string[];
  notes: string | null;
}

interface LegislationDoc {
  id: string;
  jurisdiction: string;
  type: string;
  title: string;
  shortTitle: string | null;
  year: number | null;
  inForceDate: string | null;
  lastAmendedDate: string | null;
  administeredBy: string | null;
  legislationUrl: string | null;
  sections?: LegislationSection[];
}

function LegislationPageInner() {
  // URL is the source of truth for `q` and `jurisdiction` — deep-links from
  // agents, audit trails, and the federated /search page must pre-populate
  // the page on first paint, and browser back/forward must reflect filter
  // history. (#1360)
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlJurisdiction = (() => {
    const raw = searchParams.get("jurisdiction") ?? "All";
    return (JURISDICTIONS as readonly string[]).includes(raw)
      ? (raw as Jurisdiction)
      : "All";
  })();
  const urlQuery = searchParams.get("q") ?? "";

  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(urlJurisdiction);
  const [search, setSearch] = useState(urlQuery);
  const [docs, setDocs] = useState<LegislationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Re-sync local state on browser back/forward. The URL drives state, not
  // the other way around — we mirror it back down through the components.
  useEffect(() => {
    setJurisdiction(urlJurisdiction);
  }, [urlJurisdiction]);
  useEffect(() => {
    setSearch(urlQuery);
  }, [urlQuery]);

  // Push state changes back into the URL (debounced via the existing
  // 300ms search debounce in the loadDocs effect).
  const pushUrl = useCallback(
    (j: Jurisdiction, q: string) => {
      const next = new URLSearchParams();
      if (j !== "All") next.set("jurisdiction", j);
      if (q.trim()) next.set("q", q.trim());
      const qs = next.toString();
      router.replace(qs ? `/legislation?${qs}` : "/legislation", { scroll: false });
    },
    [router]
  );

  const loadDocs = useCallback(async (j: Jurisdiction, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (j !== "All") params.set("jurisdiction", j);
      if (q.trim()) params.set("q", q.trim());
      params.set("include", "sections");
      const res = await fetch(`/api/axiom/legislation?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setDocs(data.legislation ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadDocs(jurisdiction, search);
      pushUrl(jurisdiction, search);
    }, 300);
    return () => clearTimeout(timer);
  }, [jurisdiction, search, loadDocs, pushUrl]);

  const toggleDoc = (id: string) => {
    setExpandedDoc(expandedDoc === id ? null : id);
    setExpandedSections(new Set());
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const jurisdictionColor: Record<string, string> = {
    CTH: "text-pact-cyan border-pact-cyan/30",
    QLD: "text-pact-purple border-pact-purple/30",
    NSW: "text-green-600 border-green-500/30",
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/" className="text-pact-dim text-xs hover:text-pact-cyan mb-6 block">
        &larr; Back to PACT
      </Link>

      <h1 className="text-3xl font-bold mb-2">Australian Legislation</h1>
      <p className="text-pact-dim text-sm mb-8">
        Browse structured legislation across QLD, NSW, and Commonwealth.
        Every section is pre-chunked and machine-readable.
      </p>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center bg-background/80 border border-card-border rounded-full p-0.5 text-xs">
          {JURISDICTIONS.map((j) => (
            <button
              key={j}
              onClick={() => setJurisdiction(j)}
              className={`px-3 py-1 rounded-full transition-all ${
                jurisdiction === j
                  ? "bg-pact-cyan text-background font-bold"
                  : "text-pact-dim hover:text-foreground"
              }`}
            >
              {j}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search by keyword..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 bg-background border border-card-border rounded-lg text-xs focus:outline-none focus:border-pact-cyan"
        />
      </div>

      {loading ? (
        <div className="text-center py-20 text-pact-dim text-sm">Loading legislation...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-20 text-pact-dim text-sm">No legislation found for this filter.</div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const isExpanded = expandedDoc === doc.id;
            const color = jurisdictionColor[doc.jurisdiction] ?? "text-foreground border-card-border";
            return (
              <div key={doc.id} className={`bg-card-bg border ${color.split(" ")[1]} rounded-xl overflow-hidden`}>
                <button
                  onClick={() => toggleDoc(doc.id)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-hover-bg transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${color.split(" ")[0]}`}>
                        {doc.jurisdiction}
                      </span>
                      <span className="text-[10px] text-pact-dim">{doc.type}</span>
                      {doc.year && <span className="text-[10px] text-pact-dim">{doc.year}</span>}
                    </div>
                    <div className="font-bold text-sm truncate">{doc.title}</div>
                    {doc.administeredBy && (
                      <div className="text-[10px] text-pact-dim mt-0.5">{doc.administeredBy}</div>
                    )}
                  </div>
                  <div className="text-pact-dim text-xs shrink-0">
                    {doc.sections?.length ?? 0} sections {isExpanded ? "▲" : "▼"}
                  </div>
                </button>

                {isExpanded && doc.sections && doc.sections.length > 0 && (
                  <div className="border-t border-card-border px-5 py-3 space-y-1">
                    {doc.sections.map((sec) => {
                      const secKey = `${doc.id}:${sec.sectionId}`;
                      const secExpanded = expandedSections.has(secKey);
                      return (
                        <div key={secKey}>
                          <button
                            onClick={() => toggleSection(secKey)}
                            className="w-full text-left py-2 flex items-start gap-2 hover:bg-hover-bg/50 rounded px-2 -mx-2 transition-colors"
                          >
                            <span className="text-pact-cyan font-mono text-xs shrink-0 w-16 text-right">
                              {sec.sectionId}
                            </span>
                            <span className="text-xs font-medium">{sec.title || "(untitled)"}</span>
                          </button>
                          {secExpanded && (
                            <div className="ml-[4.5rem] pb-3">
                              <p className="text-xs text-pact-dim leading-relaxed whitespace-pre-wrap">
                                {sec.content}
                              </p>
                              {sec.crossReferences.length > 0 && (
                                <div className="mt-2 text-[10px] text-pact-dim">
                                  Cross-references: {sec.crossReferences.join(", ")}
                                </div>
                              )}
                              {sec.notes && (
                                <div className="mt-1 text-[10px] text-pact-orange">{sec.notes}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {doc.legislationUrl && (
                      <div className="pt-2 border-t border-card-border/50 mt-2">
                        <a
                          href={doc.legislationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-pact-cyan hover:underline"
                        >
                          View on official legislation register &rarr;
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-10 bg-card-bg border border-card-border rounded-xl p-5 text-center">
        <p className="text-xs text-pact-dim mb-2">Want machine-readable access?</p>
        <code className="text-xs text-pact-cyan bg-background px-3 py-1.5 rounded block">
          GET https://pact.tailor.au/api/axiom/legislation?jurisdiction=QLD
        </code>
        <Link href="/axiom" className="text-xs text-pact-cyan hover:underline mt-2 inline-block">
          API Reference &rarr;
        </Link>
      </div>
    </div>
  );
}

export default function LegislationPage() {
  // Suspense wrapper required for useSearchParams() in Next.js App Router.
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-4 py-10 text-pact-dim text-sm">Loading legislation…</div>}>
      <LegislationPageInner />
    </Suspense>
  );
}
