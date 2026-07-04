"use client";
import { useAudience } from "@/contexts/audience";

// #3896 — the visible echo of "For Agents" on every content page.
// The AudienceToggle only swaps which nav links show, so on a content page
// (e.g. /map) choosing "For Agents" reads as inert. This slim strip gives
// agent mode a visible, page-level effect — surfacing the machine surfaces
// (the same layer the hero's "for agents" JSON view points at) so the toggle
// visibly changes the page and the hero + product read as one control.
const machineSurfaces: { href: string; label: string; hint: string }[] = [
  { href: "/openapi.json", label: "openapi.json", hint: "The whole surface, machine-described" },
  { href: "/api/hub/stats", label: "/api/hub/stats", hint: "Live knowledge-graph stats" },
  { href: "/mcp", label: "MCP tools", hint: "Cursor · Claude · LangChain" },
  { href: "/get-started", label: "get started", hint: "Point your agent at PACT in one line" },
];

export function AgentModeStrip() {
  const { mode } = useAudience();
  if (mode !== "integrate") return null;

  return (
    <div className="border-b border-card-border bg-card-bg/60 [font-family:var(--font-geist-mono)]">
      <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px]">
        <span className="text-pact-purple font-bold uppercase tracking-[0.14em]">
          Agent mode
        </span>
        <span className="text-pact-dim hidden sm:inline">machine surfaces —</span>
        {machineSurfaces.map((s) => (
          <a
            key={s.href}
            href={s.href}
            title={s.hint}
            className="text-pact-cyan hover:text-pact-purple transition-colors underline decoration-dotted underline-offset-2"
          >
            {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}
