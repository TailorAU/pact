/**
 * #1152 Round 3a — LLM fallback for scenario matching.
 *
 * Called when the deterministic predicate matcher returns no candidate with
 * confidence >= 0.5. The LLM is given the full scenario list (id + title +
 * predicates) and the caller's predicates, and is asked to pick the best
 * match plus a short rationale. The matcher's output — not this LLM call —
 * is the primary signal; this is a graceful-degradation fallback only.
 */
import { log } from "@/lib/logger";
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
      max_tokens: 3072,
      response_format: { type: "json_object" },
    });
    const choice = completion.choices[0];
    const raw = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (!raw) {
      log.warn(
        { op: "scenarios.llm_match.empty", finishReason: choice?.finish_reason ?? null },
        "[scenarios/llm-match] empty completion content",
      );
      return null;
    }

    const parsedUnknown: unknown = JSON.parse(raw);
    if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
      log.warn(
        { op: "scenarios.llm_match.invalid_shape", finishReason: choice?.finish_reason ?? null },
        "[scenarios/llm-match] non-object completion payload",
      );
      return null;
    }

    const parsed = parsedUnknown as Record<string, unknown>;
    const candidateId = typeof parsed.scenarioId === "string" ? parsed.scenarioId : null;
    const valid = candidateId !== null && scenarios.some((s) => s.id === candidateId);
    const rationale =
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : "(no rationale)";

    return {
      model: completion.model || requestedModel,
      scenarioId: valid ? candidateId : null,
      rationale,
    };
  } catch (err) {
    log.error({ op: "scenarios.llm_match.error", err }, "[scenarios/llm-match] fallback error");
    return null;
  }
}
