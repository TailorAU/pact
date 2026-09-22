/**
 * WS13 — GET /api/audit/me
 *
 * Privacy Act APP 12 self-serve: an authenticated agent can retrieve their
 * own audit-log entries without going through an operator.
 *
 * Auth:    x-source-agent-key header — same convention as /api/work/* routes.
 *          Key is SHA-256 hashed to match actor_key_hash in audit_log.
 *          Anonymous callers receive 401.
 *
 * Filtering / pagination:
 *   ?limit=<n>             default 50, max 500
 *   ?cursor=<opaque>       stable cursor — base64url(JSON({created_at, id}))
 *                          from a previous response's next_cursor field.
 *
 * Response:
 *   {
 *     results: [{ op, entity_type, entity_id, before_json, after_json,
 *                 request_id, ip_country, created_at }],
 *     next_cursor: "<string>" | null,
 *     has_more: boolean
 *   }
 *
 * Deliberately omits actor_key_hash and actor_label from results — the
 * caller already knows who they are; echoing the hash adds no value.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { resolveAgentFromKey } from "@/lib/work/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

interface CursorPayload {
  created_at: string;
  id: string | number;
}

function encodeCursor(created_at: string, id: string | number): string {
  return Buffer.from(JSON.stringify({ created_at, id })).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "created_at" in parsed &&
      "id" in parsed
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // ── Authentication ────────────────────────────────────────────────────────
  const agent = await resolveAgentFromKey(req);
  if (!agent) {
    return NextResponse.json(
      { error: "x-source-agent-key required and must match a registered agent" },
      { status: 401 },
    );
  }

  // Re-derive the hash that was stored at write time (audit.ts uses the same
  // createHash("sha256").update(key).digest("hex") path via hashActorKey).
  const rawKey = req.headers.get("x-source-agent-key") ?? "";
  const actorKeyHash = createHash("sha256").update(rawKey).digest("hex");

  // ── Query params ──────────────────────────────────────────────────────────
  const sp = req.nextUrl.searchParams;

  const rawLimit = parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const cursorParam = sp.get("cursor");
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;

  // ── Query ─────────────────────────────────────────────────────────────────
  const db = await getDb();

  let sql: string;
  const args: unknown[] = [];

  if (cursor) {
    // Keyset pagination: rows created before the cursor timestamp,
    // OR at the same timestamp with a smaller id (handles ties).
    sql = `SELECT id, created_at, op, entity_type, entity_id,
                  before_json, after_json, request_id, ip_country
           FROM audit_log
           WHERE actor_key_hash = ?
             AND (
               created_at < ?
               OR (created_at = ? AND id < ?)
             )
           ORDER BY created_at DESC, id DESC
           LIMIT ?`;
    args.push(
      actorKeyHash,
      cursor.created_at,
      cursor.created_at,
      cursor.id,
      limit + 1,
    );
  } else {
    sql = `SELECT id, created_at, op, entity_type, entity_id,
                  before_json, after_json, request_id, ip_country
           FROM audit_log
           WHERE actor_key_hash = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`;
    args.push(actorKeyHash, limit + 1);
  }

  const result = await db.execute({ sql, args });
  const rows = result.rows;

  const has_more = rows.length > limit;
  const pageRows = has_more ? rows.slice(0, limit) : rows;

  const lastRow = pageRows[pageRows.length - 1];
  const next_cursor =
    has_more && lastRow
      ? encodeCursor(
          lastRow.created_at as string,
          lastRow.id as string | number,
        )
      : null;

  const results = pageRows.map((r) => ({
    op: r.op,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    before_json: r.before_json,
    after_json: r.after_json,
    request_id: r.request_id,
    ip_country: r.ip_country,
    created_at: r.created_at,
  }));

  return NextResponse.json({ results, next_cursor, has_more });
}
