/**
 * #1152 Round 5a — /map graph legend.
 *
 * Explains the three node shapes (topic / legislation / scenario) and the
 * four edge types (depends_on / cites / applies_when / co_applies) so the
 * SVG is self-explanatory without hover affordances.
 */
export default function GraphLegend() {
  return (
    <div className="bg-card-bg border border-card-border rounded-lg px-4 py-3 mb-3 text-xs text-pact-dim flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="uppercase tracking-wider text-[10px] font-bold text-pact-dim/60">Nodes</span>

      <span className="flex items-center gap-1.5">
        <svg width={18} height={18} aria-hidden="true">
          <circle cx={9} cy={9} r={5} fill="#fbbf24" stroke="#fbbf24" strokeWidth={1} />
        </svg>
        <span>Topic (circle)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={18} height={18} aria-hidden="true">
          <rect x={3} y={5} width={12} height={8} rx={1} fill="#94a3b8" stroke="#cbd5e1" strokeWidth={1} />
        </svg>
        <span>Legislation (rectangle)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={18} height={18} aria-hidden="true">
          <polygon points="9,2 16,9 9,16 2,9" fill="#fb923c" stroke="#fb923c" strokeWidth={1} />
        </svg>
        <span>Scenario (diamond)</span>
      </span>

      <span className="mx-2 text-white/10">|</span>
      <span className="uppercase tracking-wider text-[10px] font-bold text-pact-dim/60">Edges</span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke="#fbbf24" strokeWidth={2} />
        </svg>
        <span>depends_on (topic → topic)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke="#94a3b8" strokeWidth={1} />
        </svg>
        <span>cites (topic → legislation)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke="#fb923c" strokeWidth={2} strokeDasharray="4 3" />
        </svg>
        <span>applies_when (scenario → *)</span>
      </span>

      <span className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={3} x2={22} y2={3} stroke="#a5b4fc" strokeWidth={1} />
          <line x1={2} y1={7} x2={22} y2={7} stroke="#a5b4fc" strokeWidth={1} />
        </svg>
        <span>co_applies (scenario-scoped)</span>
      </span>
    </div>
  );
}
