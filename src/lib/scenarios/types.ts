/**
 * #1152 Round 3a — Scenario types shared across API routes + lib.
 */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  industry: string | null;
  predicates: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sourceRef: string | null;
  jurisdiction: string | null;
  reviewCount: number;
}

export interface ScenarioAppliesWhen {
  id: string;
  scenarioId: string;
  topicId: string | null;
  legislationId: string | null;
  predicate: Record<string, unknown>;
  note: string | null;
}

export interface CoApplies {
  id: string;
  leftTopicId: string | null;
  leftLegislationId: string | null;
  rightTopicId: string | null;
  rightLegislationId: string | null;
  scenarioIds: string[];
  relationship: string;
  note: string | null;
}
