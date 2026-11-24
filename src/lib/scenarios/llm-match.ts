/**
 * #1152 Round 3a — LLM fallback for scenario matching.
 *
 * Called when the deterministic predicate matcher returns no candidate with
 * confidence >= 0.5. The LLM is given the full scenario list (id + title +
 * predicates) and the caller's predicates, and is asked to pick the best
 * match plus a short rationale. The matcher's output — not this LLM call —
 * is the primary signal; this is a graceful-degradation fallback only.
 */
import {
  getSovrgnClient,
  getSovrgnModel,
  supportsCustomTemperature,
} from "../sovrgn-client";
import type { Scenario } from "./types";

const SYSTEM_PROMPT = `You are a regulatory-scenario matcher. Given a JSON list of scenarios and a caller's predicates, pick the single best-matching scenario id or return null if none reasonably fit. Respond ONLY with JSON of shape {"scenarioId": string|null, "rationale": string}. Do not invent scenario ids.`;

export interface LlmFallbackResult {
  model: string;
  scenarioId: string | null;
  rationale: string;
}

export async function llmMatch(
  scenarios: Pick<Scenario, "id" | "title" | "predicates">[],
  callerPredicates: Record<string, unknown>,
): Promise<LlmFallbackResult | null> {
  const client = getSovrgnClient();
  if (!client) return null;

  const requestedModel = getSovrgnModel();
  try {
    const completion = await client.chat.completions.create({
      model: requestedModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            scenarios: scenarios.map((s) => ({ id: s.id, title: s.title, predicates: s.predicates })),
            callerPredicates,
          }),
        },
      ],
      ...(supportsCustomTemperature(requestedModel) ? { temperature: 0.1 } : {}),
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { scenarioId?: string | null; rationale?: string };
    const valid = scenarios.some((s) => s.id === parsed.scenarioId);
    return {
      model: completion.model || requestedModel,
      scenarioId: valid ? parsed.scenarioId ?? null : null,
      rationale: parsed.rationale ?? "(no rationale)",
    };
  } catch (err) {
    console.error("[scenarios/llm-match] fallback error:", err);
    return null;
  }
}
