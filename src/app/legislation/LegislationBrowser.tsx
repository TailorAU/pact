"use client";
import { useState } from "react";
import Link from "next/link";

interface LegDoc {
  id: string;
  title: string;
  short_title: string | null;
  jurisdiction: string;
  doc_type: string;
  year: number | null;
  legislation_url: string | null;
  last_amended_date: string | null;
  sectionCount: number;
}

interface Section {
  sectionId: string;
  title: string | null;
  content: string;
  depth: number;
  parentSection: string | null;
  status: string;
}

export function LegislationBrowser({
  jurisdictions,
  jurisdictionKeys,
}: {
  jurisdictions: Record<string, LegDoc[]>;
  jurisdictionKeys: string[];
}) {
  const [activeJurisdiction, setActiveJurisdiction] = useState(jurisdictionKeys[0] || "QLD");
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, Section[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[] | null>(null);

  const loadSections = async (docId: string) => {
    if (sections[docId]) {
      setExpandedDoc(expandedDoc === docId ? null : docId);
      return;
    }
    setLoading(docId);
    try {
      const res = await fetch(`/api/axiom/legislation/${encodeURIComponent(docId)}`);
      const data = await res.json();
      setSections((prev) => ({ ...prev, [docId]: data.sections || [] }));
      setExpandedDoc(docId);
    } catch {
      setSections((prev) => ({ ...prev, [docId]: [] }));
    }
    setLoading(null);
  };

  const handleSearch = async () => {
    if (!search.trim()) { setSearchResults(null); return; }
    try {
      const res = await fetch(`/api/axiom/legislation/search?q=${encodeURIComponent(search)}&limit=20`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    }
  };

  const jurisdictionNames: Record<string, string> = {
    CTH: "Commonwealth",
    QLD: "Queensland",
    NSW: "New South Wales",
    VIC: "Victoria",
    WA: "Western Australia",
    SA: "South Australia",
    TAS: "Tasmania",
    ACT: "Australian Capital Territory",
    NT: "Northern Territory",
  };

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search legislation (e.g. 'mine safety', 'unfair dismissal')"
          className="flex-1 px-4 py-2 bg-card-bg border border-card-border rounded-lg text-sm text-foreground placeholder:text-pact-dim/50 focus:outline-none focus:border-pact-cyan"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-pact-cyan text-background font-bold text-sm rounded-lg hover:bg-pact-cyan/80 transition-colors"
        >
          Search
        </button>
        {searchResults && (
          <button
            onClick={() => setSearchResults(null)}
            className="px-3 py-2 text-pact-dim text-sm hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {searchResults ? (
        <div className="space-y-3">
          <p className="text-xs text-pact-dim">{searchResults.length} results for &ldquo;{search}&rdquo;</p>
          {searchResults.map((r, i) => (
            <div key={i} className="bg-card-bg border border-card-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 bg-pact-cyan/10 text-pact-cyan rounded">{r.jurisdiction as string}</span>
                <span className="text-xs text-pact-dim">{r.docTitle as string}</span>
              </div>
              <div className="font-bold text-sm mb-1">{r.sectionId as string}: {r.sectionTitle as string}</div>
              <p className="text-xs text-pact-dim line-clamp-3">{(r.content as string)?.slice(0, 300)}...</p>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-6 flex-wrap">
            {jurisdictionKeys.map((j) => (
              <button
                key={j}
                onClick={() => setActiveJurisdiction(j)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  activeJurisdiction === j
                    ? "bg-pact-cyan text-background"
                    : "bg-card-bg border border-card-border text-pact-dim hover:text-foreground"
                }`}
              >
                {j} ({jurisdictions[j]?.length || 0})
              </button>
            ))}
          </div>

          <h2 className="text-lg font-bold mb-4">{jurisdictionNames[activeJurisdiction] || activeJurisdiction}</h2>

          <div className="space-y-3">
            {(jurisdictions[activeJurisdiction] || []).map((doc) => (
              <div key={doc.id} className="bg-card-bg border border-card-border rounded-lg overflow-hidden">
                <button
                  onClick={() => loadSections(doc.id)}
                  className="w-full text-left px-5 py-4 hover:bg-hover-bg transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm">{doc.title}</div>
                      <div className="text-xs text-pact-dim mt-0.5">
                        {doc.doc_type} &middot; {doc.sectionCount} sections
                        {doc.last_amended_date && ` · last amended ${doc.last_amended_date}`}
                      </div>
                    </div>
                    <span className="text-pact-dim text-xs">
                      {loading === doc.id ? "Loading..." : expandedDoc === doc.id ? "▼" : "▶"}
                    </span>
                  </div>
                </button>

                {expandedDoc === doc.id && sections[doc.id] && (
                  <div className="border-t border-card-border px-5 py-3 space-y-2">
                    {doc.legislation_url && (
                      <a href={doc.legislation_url} target="_blank" rel="noopener noreferrer" className="text-xs text-pact-cyan hover:underline">
                        View on official gazette →
                      </a>
                    )}
                    {sections[doc.id].map((s, i) => (
                      <details key={i} className="group">
                        <summary className="cursor-pointer text-sm py-1 hover:text-pact-cyan transition-colors flex items-center gap-2">
                          <span className="text-pact-cyan font-mono text-xs w-16 shrink-0">{s.sectionId}</span>
                          <span className="text-foreground">{s.title || "Untitled"}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === "in_force" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"}`}>
                            {s.status}
                          </span>
                        </summary>
                        <div className="pl-[4.5rem] py-2 text-xs text-pact-dim leading-relaxed whitespace-pre-wrap">
                          {s.parentSection && <div className="text-[10px] text-pact-purple mb-1">{s.parentSection}</div>}
                          {s.content}
                        </div>
                      </details>
                    ))}
                    {sections[doc.id].length === 0 && (
                      <p className="text-xs text-pact-dim py-2">No sections available for this document.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
