/**
 * #1152 Round 3a — Shared scenario read helpers.
 */
import { getDb } from "../db";
import type { Scenario, ScenarioAppliesWhen, CoApplies } from "./types";

function coerceJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function coerceTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

function rowToScenario(row: Record<string, unknown>): Scenario {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    industry: (row.industry as string | null) ?? null,
    predicates: coerceJson(row.predicates),
    tags: coerceTags(row.tags),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listScenarios(): Promise<Scenario[]> {
  const db = await getDb();
  const r = await db.execute("SELECT id, title, description, industry, predicates, tags, created_at, updated_at FROM scenarios ORDER BY industry NULLS LAST, title ASC");
  return r.rows.map(rowToScenario);
}

export async function getScenario(id: string): Promise<Scenario | null> {
  const db = await getDb();
  const r = await db.execute({
    sql: "SELECT id, title, description, industry, predicates, tags, created_at, updated_at FROM scenarios WHERE id = ?",
    args: [id],
  });
  return r.rows[0] ? rowToScenario(r.rows[0]) : null;
}

export async function getAppliesWhen(scenarioId: string): Promise<ScenarioAppliesWhen[]> {
  const db = await getDb();
  const r = await db.execute({
    sql: `SELECT id, scenario_id, topic_id, legislation_id, predicate, note
          FROM scenario_applies_when WHERE scenario_id = ?`,
    args: [scenarioId],
  });
  return r.rows.map((row) => ({
    id: String(row.id),
    scenarioId: String(row.scenario_id),
    topicId: (row.topic_id as string | null) ?? null,
    legislationId: (row.legislation_id as string | null) ?? null,
    predicate: coerceJson(row.predicate),
    note: (row.note as string | null) ?? null,
  }));
}

export async function getCoApplies(scenarioId: string): Promise<CoApplies[]> {
  const db = await getDb();
  // Postgres array contains — use raw SQL since pgify doesn't special-case ANY.
  const r = await db.execute({
    sql: `SELECT id, left_topic_id, left_legislation_id, right_topic_id, right_legislation_id,
                 scenario_ids, relationship, note
          FROM legislation_co_applies
          WHERE ? = ANY (scenario_ids)`,
    args: [scenarioId],
  });
  return r.rows.map((row) => ({
    id: String(row.id),
    leftTopicId: (row.left_topic_id as string | null) ?? null,
    leftLegislationId: (row.left_legislation_id as string | null) ?? null,
    rightTopicId: (row.right_topic_id as string | null) ?? null,
    rightLegislationId: (row.right_legislation_id as string | null) ?? null,
    scenarioIds: Array.isArray(row.scenario_ids) ? (row.scenario_ids as string[]) : [],
    relationship: String(row.relationship),
    note: (row.note as string | null) ?? null,
  }));
}
