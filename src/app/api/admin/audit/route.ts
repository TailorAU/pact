// Admin endpoint: query the audit log.
//
// Auth: X-Admin-Key header against ADMIN_SECRET env var (same pattern as
// /api/scenarios admin write path and /api/axiom/legislation/ingest).
//
// Filters (query params):
//   op           — exact match on op (e.g. "pact.proposal.create")
//   entityType   — exact match on entity_type
//   entityId     — exact match on entity_id
//   actorHash    — exact match on actor_key_hash (SHA-256 hex)
//   since        — ISO timestamp; rows with created_at >= since
//   limit        — max rows (default 100, max 1000)
//   offset       — pagination offset
//
// Returns JSON array of audit entries. JSON snapshots are returned as raw
// strings (caller can JSON.parse if needed); this keeps the response shape
// stable regardless of JSONB / TEXT storage decisions.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const op = sp.get("op");
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");
  const actorHash = sp.get("actorHash");
  const since = sp.get("since");
  const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10) || 100, 1000);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  const where: string[] = [];
  const args: unknown[] = [];

  if (op) {
    where.push("op = ?");
    args.push(op);
  }
  if (entityType) {
    where.push("entity_type = ?");
    args.push(entityType);
  }
  if (entityId) {
    where.push("entity_id = ?");
    args.push(entityId);
  }
  if (actorHash) {
    where.push("actor_key_hash = ?");
    args.push(actorHash);
  }
  if (since) {
    where.push("created_at >= ?");
    args.push(since);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  args.push(limit, offset);

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT id, created_at, actor_key_hash, actor_label, op, entity_type, entity_id,
                 before_json, after_json, request_id, ip_country
          FROM audit_log
          ${whereSql}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
    args,
  });

  return NextResponse.json({
    entries: result.rows,
    count: result.rows.length,
    limit,
    offset,
  });
}
