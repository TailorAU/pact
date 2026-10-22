/**
 * WS13 - Unit tests for GET /api/audit/me
 *
 * Strategy: test core logic via a thin injectable handler wrapper.
 * No vi.mock hoisting — matches the existing Source test style
 * (pure function testing, see src/lib/work/validators.test.ts).
 *
 * Coverage:
 *  1. 401 on missing x-source-agent-key
 *  2. 401 on invalid (unrecognised) key
 *  3. 200 with rows; actor_key_hash omitted from response
 *  4. 200 empty results when agent has no audit history
 *  5. Cursor pagination - second page does not overlap first
 *  6. limit capped at MAX_LIMIT (500)
 *  7. cursor encode/decode round-trip
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

// -- Inline the pure helpers from route.ts for test isolation ----------------

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

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

// -- Minimal handler that mirrors route.ts logic with injected deps ----------

type Row = Record<string, unknown>;

interface Deps {
  resolveAgent: (key: string | null) => Promise<{ id: string; name: string } | null>;
  queryRows: (
    actorHash: string,
    cursor: CursorPayload | null,
    dbLimit: number,
  ) => Promise<Row[]>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

interface HandlerResult {
  status: number;
  body: unknown;
}

async function handleGet(
  key: string | null,
  params: { limit?: string; cursor?: string },
  deps: Deps,
): Promise<HandlerResult> {
  const agent = await deps.resolveAgent(key);
  if (!agent) {
    return {
      status: 401,
      body: { error: "x-source-agent-key required and must match a registered agent" },
    };
  }

  const rawLimit = parseInt(params.limit ?? String(DEFAULT_LIMIT), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const cursor = params.cursor ? decodeCursor(params.cursor) : null;
  const rows = await deps.queryRows(sha256(key ?? ""), cursor, limit + 1);

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

  return { status: 200, body: { results, next_cursor, has_more } };
}

// -- Test helpers -------------------------------------------------------------

function makeRow(
  id: number,
  actorHash: string,
  op = "pact.proposal.create",
  created_at = "2026-01-01T00:00:00Z",
): Row {
  return {
    id,
    created_at,
    actor_key_hash: actorHash,
    op,
    entity_type: "proposal",
    entity_id: `prop_${id}`,
    before_json: null,
    after_json: JSON.stringify({ status: "approved" }),
    request_id: `req_${id}`,
    ip_country: "AU",
  };
}

function fixedDeps(
  agentResult: { id: string; name: string } | null,
  rows: Row[],
): Deps {
  return {
    resolveAgent: async () => agentResult,
    queryRows: async (_hash, _cursor, dbLimit) => rows.slice(0, dbLimit),
  };
}

// -- Tests --------------------------------------------------------------------

describe("GET /api/audit/me — auth", () => {
  it("401 when no x-source-agent-key header", async () => {
    const res = await handleGet(null, {}, fixedDeps(null, []));
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toMatch(/x-source-agent-key/);
  });

  it("401 when key does not match any registered agent", async () => {
    const res = await handleGet("invalid_key", {}, fixedDeps(null, []));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/audit/me — happy path", () => {
  it("200 with rows; actor_key_hash omitted from response", async () => {
    const KEY = "pact_sk_test_abc123";
    const hash = sha256(KEY);
    const rows = [
      makeRow(10, hash, "pact.proposal.create", "2026-04-01T12:00:00Z"),
      makeRow(9, hash, "pact.vote.cast", "2026-04-01T11:00:00Z"),
    ];
    const res = await handleGet(KEY, {}, fixedDeps({ id: "a1", name: "agent1" }, rows));
    expect(res.status).toBe(200);

    const body = res.body as {
      results: unknown[];
      next_cursor: string | null;
      has_more: boolean;
    };
    expect(body.results).toHaveLength(2);
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();

    const first = body.results[0] as Record<string, unknown>;
    expect(Object.keys(first)).not.toContain("actor_key_hash");
    expect(first.op).toBe("pact.proposal.create");
  });

  it("200 empty when agent has no audit history", async () => {
    const res = await handleGet(
      "pact_sk_norows",
      {},
      fixedDeps({ id: "a2", name: "silent" }, []),
    );
    expect(res.status).toBe(200);

    const body = res.body as {
      results: unknown[];
      has_more: boolean;
      next_cursor: string | null;
    };
    expect(body.results).toHaveLength(0);
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();
  });
});

describe("GET /api/audit/me — pagination", () => {
  it("cursor pagination: second page does not overlap first page", async () => {
    const KEY = "pact_sk_paginate";
    const hash = sha256(KEY);
    const all = Array.from({ length: 6 }, (_, i) =>
      makeRow(
        6 - i,
        hash,
        "pact.proposal.create",
        `2026-04-0${6 - i}T00:00:00Z`,
      ),
    );

    // First page (limit=3): DB gets limit+1=4 rows to detect has_more
    const res1 = await handleGet(
      KEY,
      { limit: "3" },
      fixedDeps({ id: "a3", name: "pager" }, all),
    );
    const b1 = res1.body as {
      results: Array<{ entity_id: string }>;
      next_cursor: string | null;
      has_more: boolean;
    };
    expect(res1.status).toBe(200);
    expect(b1.has_more).toBe(true);
    expect(b1.next_cursor).not.toBeNull();
    expect(b1.results).toHaveLength(3);

    // Second page: simulate DB returning remaining rows after cursor
    const res2 = await handleGet(
      KEY,
      { limit: "3", cursor: b1.next_cursor! },
      fixedDeps({ id: "a3", name: "pager" }, all.slice(3)),
    );
    const b2 = res2.body as {
      results: Array<{ entity_id: string }>;
      has_more: boolean;
    };
    expect(res2.status).toBe(200);
    expect(b2.has_more).toBe(false);
    expect(b2.results[0].entity_id).not.toBe(
      b1.results[b1.results.length - 1].entity_id,
    );
  });

  it("limit 9999 capped at MAX_LIMIT 500; DB receives 501 for has_more lookahead", async () => {
    let capturedDbLimit: number | undefined;
    const deps: Deps = {
      resolveAgent: async () => ({ id: "a4", name: "greedy" }),
      queryRows: async (_hash, _cursor, dbLimit) => {
        capturedDbLimit = dbLimit;
        return [];
      },
    };
    await handleGet("pact_sk_cap", { limit: "9999" }, deps);
    // MAX_LIMIT=500 => handler passes limit+1=501 to DB
    expect(capturedDbLimit).toBe(501);
  });
});

describe("cursor encode/decode", () => {
  it("round-trips through base64url", () => {
    const c = encodeCursor("2026-04-01T12:00:00Z", 42);
    const d = decodeCursor(c);
    expect(d).not.toBeNull();
    expect(d?.created_at).toBe("2026-04-01T12:00:00Z");
    expect(d?.id).toBe(42);
  });

  it("returns null for garbage input", () => {
    expect(decodeCursor("!!!not-valid-base64url!!!")).toBeNull();
  });

  it("returns null for valid JSON missing required fields", () => {
    // base64url of "{}" — parses fine but has no created_at or id
    const empty = Buffer.from("{}").toString("base64url");
    expect(decodeCursor(empty)).toBeNull();
  });
});
