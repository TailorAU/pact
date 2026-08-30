// Audit-log helper for Source.
//
// Records an immutable trail of business-relevant mutations (proposal create,
// approve, reject, vote, etc.) into the `audit_log` table for compliance and
// incident investigation.
//
// Design principles:
// - Best-effort: audit-log write failures must NEVER break the user-facing
//   operation. We catch + log + continue.
// - Hashed actors only: never store raw API keys. Caller may supply the raw
//   key (or the agent.id, which is already a non-secret); this helper hashes
//   anything passed via `actorKey`.
// - PII-light: no full IPs, no raw request bodies. Coarse country code only.
// - JSON snapshots stored as TEXT (jsonb-castable at read time) to keep the
//   schema simple and the write path resilient against JSONB validation.
//
// Privacy Act mapping + 7-year retention policy: see docs/AUDIT.md.
//
// #5566 — this is NOT the PACT §6.4 operation log, and the best-effort
// posture above is why it could never be. §6.4 needs a GAPLESS chain, and a
// dropped best-effort write is an undetectable gap. The §6.4 stream is the
// `events` table, written only through `emitEvent` (lib/db.ts), which mints
// a per-resource `sequence_number` + `prev_hash` link inside a transaction
// and THROWS on any failure to chain — see lib/provenance-chain.ts. Keep the
// two apart: audit_log is the Privacy-Act compliance trail, deliberately
// best-effort; `events` is the third-party-verifiable protocol log.

import { createHash } from "node:crypto";
import { getDb, type DbClient } from "./db";
import { log } from "./logger";

export interface AuditEntry {
  /** Raw actor identifier (API key or agent.id) — will be SHA-256 hashed before storage. */
  actorKey?: string | null;
  /** Human-readable agent label, e.g. "agent_007". Stored as-is. */
  actorLabel?: string | null;
  /** Operation in dot-notation, e.g. "pact.proposal.create". REQUIRED. */
  op: string;
  /** Domain object type, e.g. "proposal", "topic", "vote". */
  entityType?: string | null;
  /** Domain object id. */
  entityId?: string | null;
  /** Pre-state snapshot (JSON-serialisable). Optional. */
  before?: unknown;
  /** Post-state snapshot (JSON-serialisable). Optional. */
  after?: unknown;
  /** Cross-correlation request id (matches log.requestId). */
  requestId?: string | null;
  /** ISO country code. Coarse only — never the full IP. */
  ipCountry?: string | null;
}

function hashActorKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return createHash("sha256").update(key).digest("hex");
}

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Record one audit-log entry. Best-effort: never throws.
 *
 * Caller pattern:
 *   await recordAudit({
 *     actorKey: agent.id,
 *     actorLabel: agent.name,
 *     op: "pact.proposal.create",
 *     entityType: "proposal",
 *     entityId: proposalId,
 *     after: { topicId, sectionId, summary, status: proposalStatus },
 *     requestId,
 *   });
 */
export async function recordAudit(entry: AuditEntry, dbOverride?: DbClient): Promise<void> {
  try {
    const db = dbOverride ?? (await getDb());
    await db.execute({
      sql: `INSERT INTO audit_log
        (actor_key_hash, actor_label, op, entity_type, entity_id, before_json, after_json, request_id, ip_country)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        hashActorKey(entry.actorKey),
        entry.actorLabel ?? null,
        entry.op,
        entry.entityType ?? null,
        entry.entityId ?? null,
        safeStringify(entry.before),
        safeStringify(entry.after),
        entry.requestId ?? null,
        entry.ipCountry ?? null,
      ],
    });
  } catch (err) {
    // Audit failures must not break the user-facing operation.
    log.error(
      { err, op: "audit.record.failed", auditOp: entry.op, entityType: entry.entityType },
      "audit log write failed"
    );
  }
}

/** Coarse-grained country lookup from request headers. */
export function ipCountryFromHeaders(headers: Headers): string | null {
  // Cloudflare / Azure Front Door / fly.io conventions
  return (
    headers.get("cf-ipcountry") ??
    headers.get("x-vercel-ip-country") ??
    headers.get("x-azure-clientip-country") ??
    null
  );
}
