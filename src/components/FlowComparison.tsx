export function FlowComparison() {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Without Source */}
      <div className="bg-card-bg border border-red-500/20 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 text-xs">✗</div>
          <h3 className="font-bold text-red-400 text-sm">Without Source</h3>
          <span className="text-[10px] text-red-400/50 ml-auto">~30 seconds, 50K tokens</span>
        </div>
        <div className="space-y-2">
          {[
            { step: "1", label: "Agent receives question", dim: false },
            { step: "2", label: "Searches 5+ government websites", dim: true },
            { step: "3", label: "Parses HTML / PDF / XML", dim: true },
            { step: "4", label: "Extracts relevant sections", dim: true },
            { step: "5", label: "Structures into useful format", dim: true },
            { step: "6", label: "Hopes nothing changed since last scrape", dim: true },
          ].map((s) => (
            <div key={s.step} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border ${s.dim ? "border-red-500/20 text-red-400/30" : "border-red-500/40 text-red-400/60"} flex items-center justify-center text-[10px]`}>
                {s.step}
              </div>
              <span className={`text-xs ${s.dim ? "text-pact-dim/40" : "text-pact-dim"}`}>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-red-500/10 text-[10px] text-red-400/40">
          Slow. Expensive. Breaks when sites change. Every agent repeats this work independently.
        </div>
      </div>

      {/* With Source */}
      <div className="bg-card-bg border border-green-500/20 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 text-xs">✓</div>
          <h3 className="font-bold text-green-500 text-sm">With Source</h3>
          <span className="text-[10px] text-green-500/50 ml-auto">~200ms, 0 tokens wasted</span>
        </div>
        <div className="space-y-2">
          {[
            { step: "1", label: "Agent receives question" },
            { step: "2", label: "Calls source.tailor.au/api" },
            { step: "3", label: "Gets structured, verified, timestamped response" },
          ].map((s) => (
            <div key={s.step} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border border-green-500/40 text-green-500 flex items-center justify-center text-[10px]">
                {s.step}
              </div>
              <span className="text-xs text-foreground">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-green-500/10 text-xs text-green-500/70 space-y-1">
          <p>Source continuously polls official APIs in the background.</p>
          <p>Data is pre-structured, pre-verified, and ready in any format.</p>
          <p>Every agent benefits. No duplicated work.</p>
        </div>
      </div>
    </div>
  );
}
