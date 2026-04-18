/**
 * #1152 Round 5b — SourceValueChain
 *
 * Sibling component to FlowComparison. Where FlowComparison makes the *why*
 * argument ("without Source vs with Source"), SourceValueChain makes the
 * *how* argument: the agent-native pipeline from official government APIs
 * through Source's ingestion + structuring + consensus layer out to
 * whatever format an agent consumes.
 *
 * Copy mirrors ADR-002 §Agent-native positioning. Consensus is mentioned
 * once, inside the middle column, as the quality gate — not the headline.
 */
import Link from "next/link";

type Tile = {
  label: string;
  href?: string;
  note?: string;
};

const OFFICIAL_SOURCES: Tile[] = [
  { label: "CTH Federal Register of Legislation", href: "https://www.legislation.gov.au/" },
  { label: "QLD Legislation", href: "https://www.legislation.qld.gov.au/" },
  { label: "NSW Legislation", href: "https://legislation.nsw.gov.au/" },
  { label: "ASX Listing Rules" },
  { label: "JORC Code (2012)" },
  { label: "US sources", note: "coming soon (#1138)" },
];

const SOURCE_STEPS: Tile[] = [
  { label: "Ingest", note: "continuous polling" },
  { label: "Structure", note: "acts → sections → predicates" },
  { label: "PACT consensus gate", note: "quality, not headline" },
  { label: "Tri-entity graph", note: "topics + legislation + scenarios" },
];

const AGENT_OUTPUTS: Tile[] = [
  { label: "MCP tools", href: "/mcp" },
  { label: "A2A agent-card", href: "/.well-known/agent-card.json" },
  { label: "PACT REST", href: "https://github.com/TailorAU/pact" },
  { label: "OpenAPI 3.1", href: "/openapi.json" },
  { label: "Python tools", href: "https://pypi.org/project/source-tailor-tools/" },
  { label: "Gemini functions", href: "/gemini-functions.json" },
  { label: "ChatGPT Actions", href: "/.well-known/ai-plugin.json" },
];

function Column({
  heading,
  eyebrow,
  eyebrowColor,
  tiles,
  border,
}: {
  heading: string;
  eyebrow: string;
  eyebrowColor: string;
  tiles: Tile[];
  border: string;
}) {
  return (
    <div className={`bg-card-bg border ${border} rounded-xl p-6 flex flex-col`}>
      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-[10px] uppercase tracking-[0.18em] font-bold ${eyebrowColor}`}>
          {eyebrow}
        </span>
      </div>
      <h3 className="font-bold text-sm mb-4 text-foreground">{heading}</h3>
      <ul className="space-y-2">
        {tiles.map((t) => {
          const body = (
            <>
              <span className="text-xs text-foreground/85">{t.label}</span>
              {t.note && (
                <span className="block text-[10px] text-pact-dim/70 mt-0.5">{t.note}</span>
              )}
            </>
          );
          return (
            <li
              key={t.label}
              className="border border-card-border/60 rounded px-2.5 py-1.5 hover:border-card-border transition-colors"
            >
              {t.href ? (
                t.href.startsWith("http") ? (
                  <a
                    href={t.href}
                    className="block hover:text-pact-cyan transition-colors"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {body}
                  </a>
                ) : (
                  <Link href={t.href} className="block hover:text-pact-cyan transition-colors">
                    {body}
                  </Link>
                )
              ) : (
                <div>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SourceValueChain() {
  return (
    <section aria-label="Source value chain">
      <div className="grid md:grid-cols-3 gap-4 items-stretch">
        <Column
          eyebrow="1 · ingest"
          eyebrowColor="text-slate-300/80"
          heading="Official Govt APIs"
          tiles={OFFICIAL_SOURCES}
          border="border-slate-500/25"
        />
        <Column
          eyebrow="2 · structure"
          eyebrowColor="text-pact-cyan/80"
          heading="Source pipeline"
          tiles={SOURCE_STEPS}
          border="border-pact-cyan/30"
        />
        <Column
          eyebrow="3 · emit"
          eyebrowColor="text-pact-purple/80"
          heading="Agent-native emission"
          tiles={AGENT_OUTPUTS}
          border="border-pact-purple/30"
        />
      </div>
      <p className="text-[11px] text-pact-dim/60 text-center mt-3 italic">
        Official Govt APIs &rarr; Source &rarr; Agent-native emission (MCP / A2A / PACT / REST / OpenAPI / Python / Gemini).
        Consensus is the quality gate on top, not the headline.
      </p>
    </section>
  );
}

export default SourceValueChain;
