import { WARRANT_KINDS } from "@/lib/epistemic";

// Four unordered warrant kinds (#3724) — peers, rendered in distinct monochrome tones (#586).
const WARRANT_HEX: Record<string, string> = {
  empirical: "#000000",
  institutional: "#262626",
  interpretive: "#525252",
  conjectural: "#737373",
};

/**
 * #1152 Round 5a — /map Space graph legend.
 *
 * Explains the three node shapes (topic / legislation / scenario), the
 * four edge types (depends_on / cites / applies_when / co_applies), and —
 * since #3724 — the four unordered warrant kinds, so the SVG is
 * self-explanatory without hover affordances.
 */
export default function GraphLegend() {
  return (
    <div className="bg-card-bg border border-card-border px-4 py-3 mb-3 text-xs text-pact-dim flex flex-wrap items-center gap-x-6 gap-y-2 font-mono">
      <span className="uppercase tracking-wider text-[10px] font-bold text-foreground">Nodes</span>

      <span className="flex items-center gap-1.5 text-foreground">
        <svg width={18} height={18} aria-hidden="true">
          <circle cx={9} cy={9} r={5} fill="#000000" stroke="#000000" strokeWidth={1} />
        </svg>
        <span>Verified Claim / Topic (circle)</span>
      </span>

      <span className="flex items-center gap-1.5 text-foreground">
        <svg width={18} height={18} aria-hidden="true">
          <rect x={3} y={5} width={12} height={8} rx={1} fill="#404040" stroke="#000000" strokeWidth={1} />
        </svg>
        <span>Legislation &amp; Standards (rectangle)</span>
      </span>

      <span className="flex items-center gap-1.5 text-foreground">
        <svg width={18} height={18} aria-hidden="true">
          <polygon points="9,2 16,9 9,16 2,9" fill="#ffffff" stroke="#000000" strokeWidth={1.5} />
        </svg>
        <span>Trigger Scenario (diamond)</span>
      </span>

      <span className="mx-2 text-card-border">|</span>
      <span className="uppercase tracking-wider text-[10px] font-bold text-foreground">Edges</span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke="#000000" strokeWidth={2} />
        </svg>
        <span>depends_on (claim → claim)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke="#525252" strokeWidth={1.25} />
        </svg>
        <span>cites (claim → legislation)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke="#000000" strokeWidth={1.75} strokeDasharray="4 3" />
        </svg>
        <span>applies_when (scenario → *)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={3} x2={22} y2={3} stroke="#404040" strokeWidth={1} />
          <line x1={2} y1={7} x2={22} y2={7} stroke="#404040" strokeWidth={1} />
        </svg>
        <span>co_applies (scenario-scoped)</span>
      </span>

      <span className="mx-2 text-card-border">|</span>
      <span className="uppercase tracking-wider text-[10px] font-bold text-foreground">Warrant &middot; unordered</span>

      {WARRANT_KINDS.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5 capitalize">
          <span className="w-2 h-2 rounded-full border border-foreground" style={{ backgroundColor: WARRANT_HEX[kind] }} />
          <span style={{ color: WARRANT_HEX[kind] }}>{kind}</span>
        </span>
      ))}

      <span className="w-full text-[10px] text-pact-dim">
        Z-axis position = dependency depth, not certainty. The four warrant kinds are unordered peers &mdash; how a claim is justified in Space, not how certain it is.
      </span>
    </div>
  );
}
