/**
 * #1152 Round 4 — POST /api/work/claim
 *
 * Hand out an open `agent_work_assignment` to the calling agent. The schema
 * requires agent_id NOT NULL, so "claim" means:
 *   1. If an existing open assignment is already bound to the caller, mark it
 *      `claimed` and return it.
 *   2. Otherwise, create a new self-service assignment for the caller with
 *      the reward fixed by `work_type` (see ADR-002 §2 Decision C).
 *
 * Caller must supply `x-source-agent-key`. Body shape:
 *   { "workType": "scrape" | "qa_spot_check" | "dependency_proposal",
 *     "payload": { ... },                 // optional; stored verbatim
 *     "expiresInMinutes"?: number }       // default 60
 *
 * Response: { assignment: { id, workType, payload, rewardCredits, expiresAt } }
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { resolveAgentFromKey } from "@/lib/work/auth";
import { WORK_REWARDS, type WorkType } from "@/lib/work/validators";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_MINUTES = 60;
const VALID_TYPES = new Set<WorkType>(["scrape", "qa_spot_check", "dependency_proposal"]);

export async function POST(req: Request) {
  const agent = await resolveAgentFromKey(req);
  if (!agent) {
    return NextResponse.json(
      { error: "x-source-agent-key required and must match a registered agent" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const workType = typeof body.workType === "string" ? body.workType.trim() : "";
  if (!VALID_TYPES.has(workType as WorkType)) {
    return NextResponse.json(
      {
        error:
          "workType must be one of: scrape, qa_spot_check, dependency_proposal",
      },
      { status: 400 },
    );
  }

  const expiresInMinutes = coerceMinutes(body.expiresInMinutes);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
  const payload = (body.payload ?? {}) as unknown;
  const reward = WORK_REWARDS[workType as WorkType];

  const db = await getDb();

  // Prefer returning an existing open assignment already bound to this agent.
  const existing = await db.execute({
    sql: `SELECT id, work_type, payload, reward_credits, expires_at
          FROM agent_work_assignments
          WHERE agent_id = ? AND work_type = ? AND status = 'open'
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [agent.id, workType],
  });

  let assignmentId: string;
  if (existing.rows.length > 0) {
    assignmentId = existing.rows[0].id as string;
    await db.execute({
      sql: `UPDATE agent_work_assignments
            SET status = 'claimed', claimed_at = now()
            WHERE id = ? AND status = 'open'`,
      args: [assignmentId],
    });
  } else {
    assignmentId = randomUUID();
    await db.execute({
      sql: `INSERT INTO agent_work_assignments
              (id, agent_id, work_type, payload, reward_credits, status, claimed_at, expires_at)
            VALUES (?, ?, ?, ?, ?, 'claimed', now(), ?)`,
      args: [
        assignmentId,
        agent.id,
        workType,
        JSON.stringify(payload),
        reward,
        expiresAt,
      ],
    });
  }

  const row = await db.execute({
    sql: `SELECT id, work_type, payload, reward_credits, status, expires_at
          FROM agent_work_assignments WHERE id = ?`,
    args: [assignmentId],
  });
  const r = row.rows[0];

  return NextResponse.json({
    assignment: {
      id: r.id,
      workType: r.work_type,
      payload: parseJson(r.payload),
      rewardCredits: r.reward_credits,
      status: r.status,
      expiresAt: r.expires_at,
    },
  });
}

function coerceMinutes(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return DEFAULT_EXPIRES_MINUTES;
  return Math.min(Math.floor(v), 60 * 24); // hard cap at 24h
}

function parseJson(v: unknown): unknown {
  if (v == null) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
