/**
 * Dual-axis claim tokens (#3724, child of epic #3691).
 *
 * Four DISTINCT presentational tokens for the two-axis epistemic model —
 * never fused into one composite score:
 *
 *   Axis A — WarrantBadge:        HOW a claim is justified. Four genuine,
 *                                 UNORDERED kinds. Peers, not a ladder.
 *   Axis B — StatePill:           WHERE the community stands (lifecycle).
 *   Axis B — CredenceBar:         Community confidence in [0, 0.99].
 *                                 Never renders 1.0 — hard asymptote.
 *   Axis B — ConventionStopFlag:  "We agreed to stop digging here."
 *                                 Composable with any warrant kind.
 *
 * Pure presentational components (no hooks, no server-only imports) —
 * safe in both server and client components.
 */

import { CREDENCE_ASYMPTOTE, WARRANT_KINDS, type WarrantKind } from "@/lib/epistemic";

// ── Axis A — warrant kind ────────────────────────────────────────────
// Distinct hue per kind. Deliberately no ordering cues (no numbering, no
// gradient from "good" to "bad") — these are four peer ways of being
// justified, matched to the site's existing tier palette hues.
export const WARRANT_STYLES: Record<WarrantKind, string> = {
  empirical: "text-pact-cyan border-pact-cyan/30 bg-pact-cyan/5",
  institutional: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  interpretive: "text-pact-purple border-pact-purple/30 bg-pact-purple/5",
  conjectural: "text-pact-red border-pact-red/30 bg-pact-red/5",
};

export const WARRANT_DESCRIPTIONS: Record<WarrantKind, string> = {
  empirical: "Justified by observation and experiment — refinable with new evidence.",
  institutional: "Justified by enactment or adoption — laws, standards, definitions. Scoped to jurisdiction and time.",
  interpretive: "Justified by reasoned reading — court interpretations, contested readings. Multiple valid positions possible.",
  conjectural: "Proposed but not yet warranted — open questions under active debate.",
};

export function WarrantBadge({
  kind,
  size = "sm",
}: {
  kind: WarrantKind | string;
  size?: "xs" | "sm";
}) {
  const k = (WARRANT_KINDS as readonly string[]).includes(kind) ? (kind as WarrantKind) : null;
  const cls = k ? WARRANT_STYLES[k] : "text-pact-dim border-pact-dim/30 bg-pact-dim/5";
  const pad = size === "xs" ? "text-[9px] px-1.5 py-px" : "text-[10px] px-2 py-0.5";
  return (
    <span
      className={`${pad} rounded border uppercase tracking-wider font-bold shrink-0 ${cls}`}
      title={k ? `Warrant: ${WARRANT_DESCRIPTIONS[k]} (one of four unordered kinds)` : `Warrant: ${kind}`}
    >
      {kind}
    </span>
  );
}

/**
 * The four warrant kinds rendered as a horizontal row of PEERS —
 * the canonical anti-ladder affordance. Optionally interactive via
 * `renderKind` (e.g. wrapping each badge in a filter link).
 */
export function WarrantPeerRow({
  renderKind,
}: {
  renderKind?: (kind: WarrantKind) => React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {WARRANT_KINDS.map((kind) =>
        renderKind ? (
          <span key={kind}>{renderKind(kind)}</span>
        ) : (
          <WarrantBadge key={kind} kind={kind} />
        )
      )}
    </div>
  );
}

// ── Axis B — consensus state ─────────────────────────────────────────
const STATE_STYLES: Record<string, string> = {
  proposed: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  open: "text-pact-cyan border-pact-cyan/30 bg-pact-cyan/5",
  contested: "text-pact-red border-pact-red/30 bg-pact-red/5",
  aligned: "text-pact-green border-pact-green/30 bg-pact-green/5",
  verified: "text-pact-green border-pact-green/40 bg-pact-green/10 font-bold",
};

const STATE_ICONS: Record<string, string> = {
  proposed: "◌",
  open: "○",
  contested: "!",
  aligned: "◉",
  verified: "✓",
};

export function StatePill({ state, size = "sm" }: { state: string; size?: "xs" | "sm" }) {
  const cls = STATE_STYLES[state] ?? "text-pact-dim border-pact-dim/30 bg-pact-dim/5";
  const pad = size === "xs" ? "text-[9px] px-1.5 py-px" : "text-[10px] px-2 py-0.5";
  return (
    <span
      className={`${pad} rounded-full border font-medium shrink-0 ${cls}`}
      title={`Consensus state: ${state} — every state is re-openable via challenge`}
    >
      <span className="mr-1" aria-hidden="true">{STATE_ICONS[state] ?? "·"}</span>
      {state}
    </span>
  );
}

// ── Axis B — credence ────────────────────────────────────────────────
/**
 * Horizontal credence bar over [0, 1) with a hard asymptote marker just
 * before the right edge. Credence NEVER reaches 1.0 (Cromwell's rule) —
 * the tick at 0.99 and the "→ never 1.0" caption make the asymptote
 * visible, not just implied.
 */
export function CredenceBar({
  value,
  compact = false,
}: {
  value: number | null | undefined;
  compact?: boolean;
}) {
  const v =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(Math.max(value, 0), CREDENCE_ASYMPTOTE)
      : null;
  const trackW = compact ? "w-20" : "w-36";
  const pct = v === null ? 0 : v * 100;
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0"
      title={`Credence ${v === null ? "—" : v.toFixed(2)} — asymptotic: no live claim reaches 1.0`}
    >
      <span className={`relative ${trackW} h-1.5 rounded-full bg-pact-dim/15 overflow-visible`}>
        {v !== null && (
          <span
            className="absolute left-0 top-0 h-full rounded-full bg-pact-cyan"
            style={{ width: `${pct}%` }}
          />
        )}
        {/* Hard asymptote tick at 0.99 — the unreachable ceiling */}
        <span
          className="absolute top-[-2px] h-[10px] w-[2px] bg-pact-orange"
          style={{ left: `${CREDENCE_ASYMPTOTE * 100}%` }}
          aria-hidden="true"
        />
      </span>
      <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
        {v === null ? "—" : v.toFixed(2)}
      </span>
      {!compact && (
        <span className="text-[9px] text-pact-orange/70 whitespace-nowrap">→ never 1.0</span>
      )}
    </span>
  );
}

// ── Axis B — convention stop ─────────────────────────────────────────
/**
 * Renders ONLY when the flag is true. A convention stop is where the
 * community agreed to stop digging — a consensus ROLE, not a warrant
 * kind, and never immune to challenge.
 */
export function ConventionStopFlag({
  value,
  size = "sm",
}: {
  value: boolean | number | null | undefined;
  size?: "xs" | "sm";
}) {
  if (!value) return null;
  const pad = size === "xs" ? "text-[9px] px-1.5 py-px" : "text-[10px] px-2 py-0.5";
  return (
    <span
      className={`${pad} rounded border border-amber-400/30 bg-amber-400/5 text-amber-400 shrink-0`}
      title="Convention stop: the community agreed to stop digging here — challengeable like every other node"
    >
      ⚑ held by convention · challengeable
    </span>
  );
}
