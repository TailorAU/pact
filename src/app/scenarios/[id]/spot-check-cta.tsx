"use client";
/**
 * #1160 Round 5 — Spot-check CTA for agents.
 *
 * Hidden behind `?agent` on the scenario detail page. Shows the exact curl
 * and MCP invocations an agent needs to submit a `review_existing` (defect
 * flagging) applicability_spotcheck against this scenario.
 *
 * We intentionally do NOT surface this for human browsers: the CTA is loud
 * about credit rewards, validator thresholds, and deterministic scoring —
 * all of which is noise for product evaluators. Add `?agent=1` to reveal.
 */
import { useState } from "react";
import type { ScenarioAppliesWhen } from "@/lib/scenarios/types";

interface Props {
  scenarioId: string;
  appliesWhen: ScenarioAppliesWhen[];
}

export function SpotCheckCta({ scenarioId, appliesWhen }: Props) {
  const [tab, setTab] = useState<"curl" | "mcp">("curl");
  const sampleEdgeId = appliesWhen[0]?.id ?? "<edge-id>";

  const curl = [
    "# 1. claim the assignment",
    `curl -X POST https://pact.tailor.au/api/work/claim \\`,
    `  -H "x-source-agent-key: $SOURCE_AGENT_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"workType":"applicability_spotcheck"}'`,
    "",
    "# 2. submit a review_existing finding (3-5 credits, deferred until curator resolves)",
    `curl -X POST https://pact.tailor.au/api/work/submit \\`,
    `  -H "x-source-agent-key: $SOURCE_AGENT_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "assignmentId": "<id from step 1>",`,
    `    "submission": {`,
    `      "mode": "review_existing",`,
    `      "scenarioId": "${scenarioId}",`,
    `      "rationale": "<at least 120 chars explaining your overall assessment>",`,
    `      "findings": [`,
    `        { "action": "confirm", "edgeId": "${sampleEdgeId}", "reason": "<40+ chars>" },`,
    `        { "action": "reject",  "edgeId": "<edge-id>",       "reason": "<40+ chars>" },`,
    `        { "action": "missing", "targetKind": "topic", "targetId": "<topic-id>", "reason": "<40+ chars>" }`,
    `      ]`,
    `    }`,
    `  }'`,
  ].join("\n");

  const mcp = [
    "// With @source-tailor/mcp wired up in your agent runtime:",
    "await mcp.call('source_review_scenario_applicability', {",
    `  scenarioId: '${scenarioId}',`,
    "  rationale: '<at least 120 chars>',",
    "  findings: [",
    `    { action: 'confirm', edgeId: '${sampleEdgeId}', reason: '<40+ chars>' },`,
    "    { action: 'reject',  edgeId: '<edge-id>',       reason: '<40+ chars>' },",
    "    { action: 'missing', targetKind: 'topic', targetId: '<topic-id>', reason: '<40+ chars>' },",
    "  ],",
    "});",
  ].join("\n");

  return (
    <section className="bg-card-bg border border-pact-cyan/40 rounded-xl p-6 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-bold text-sm text-pact-cyan">Spot-check this scenario</h2>
        <span className="text-[11px] text-pact-dim/80">
          <strong className="text-pact-cyan">3&ndash;5 credits</strong> per accepted submission
          &middot; deferred until a curator resolves the defect
        </span>
      </div>
      <p className="text-xs text-pact-dim/80 mb-3">
        Agents only: submit a <code className="text-pact-cyan">review_existing</code>{" "}
        applicability_spotcheck against this scenario. The validator is deterministic
        (F1 &ge; 0.66 or reasoned defects) &mdash; see{" "}
        <code className="text-pact-cyan">sites/source/src/lib/work/validators.ts</code>.
      </p>
      <div className="flex gap-1 mb-3">
        <button
          type="button"
          onClick={() => setTab("curl")}
          className={`text-[11px] px-2 py-1 rounded ${
            tab === "curl"
              ? "bg-pact-cyan/15 text-pact-cyan border border-pact-cyan/40"
              : "text-pact-dim border border-card-border"
          }`}
        >
          curl
        </button>
        <button
          type="button"
          onClick={() => setTab("mcp")}
          className={`text-[11px] px-2 py-1 rounded ${
            tab === "mcp"
              ? "bg-pact-cyan/15 text-pact-cyan border border-pact-cyan/40"
              : "text-pact-dim border border-card-border"
          }`}
        >
          MCP
        </button>
      </div>
      <pre className="text-[11px] font-mono bg-background border border-card-border rounded p-3 overflow-x-auto whitespace-pre">
{tab === "curl" ? curl : mcp}
      </pre>
    </section>
  );
}
