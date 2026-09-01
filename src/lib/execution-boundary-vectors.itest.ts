/**
 * #5535 — the two internal-reversible PACT v2.3 execution-boundary session
 * vectors, EXECUTED against the real KG route handlers on real Postgres.
 *
 * The pre-#5535 suite carried hand-adapted restatements of these vectors and
 * said so (effect-class.test.ts's honesty note; #5537 tracked it). This file
 * replaces the restatement with execution: every step below is read from the
 * vendored vector fixture (`fixtures/pact-v23/execution-boundary-vectors.json`
 * — verbatim-lossless raw YAML + SHA-256 + parsed rendering, generated from
 * TailorAU/pact @ the pinned commit by
 * tools/pact-conformance/convert_execution_boundary_session_vectors.py, the
 * #5640 pattern), dispatched to the REAL route module the KG serves that
 * surface with, and asserted against the vector's own `expected_response`
 * block — status, subset body match, and cross-call negative obligations.
 * Nothing here retypes an expectation.
 *
 * ## The declared adaptation seam — all of it, in one place
 *
 * The vectors are written against the reference server's wire. The KG is a
 * different implementation of the same protocol, and the runner maps between
 * them EXPLICITLY (see STEP_ADAPTERS / VECTOR_HOOKS / KEY_ALIASES below).
 * Every mapping is one of four kinds, each stated where it is applied:
 *
 *  1. **Surface mapping** — `/_status` and `/manifest` dispatch to
 *     `GET /api/pact/{topicId}`: the topic resource read IS the KG's status
 *     and export surface (`capabilities.manifest` stays `false` and the
 *     profile says so).
 *  2. **Id binding** — the KG mints proposal ids server-side; the vector's
 *     symbolic ids (`prop_draft_edit`, `prop_confidentiality`) are bound to
 *     the minted id at the create step and substituted into later paths and
 *     expected values. Fabric ids are bound too: each run seeds a fresh,
 *     run-suffixed fabric and binds the vector's symbolic resource_id to it,
 *     because the event store is APPEND-ONLY by doctrine (§6.4 — only
 *     retention.ts may delete an event row, and the provenance-chain G1
 *     source guard enforces that over this file as well), so a re-run must
 *     never tear a previous run's chained rows down. Principals are NOT
 *     bound — the seeded agents carry the vectors' literal did:web ids.
 *  3. **Request shaping** — the KG's create requires `newContent` (the
 *     reference server derives content from the proposal), enforces a 30s
 *     TTL floor, and its assumption QA gate is satisfied in precondition
 *     seeding (`assumptions_declared = 1`), so vector bodies pass otherwise
 *     unchanged.
 *  4. **Engine hooks** — the KG's Silence=Consent auto-merge requires at
 *     least one non-author endorsement and runs in the advisory-locked cron
 *     sweep, not inline: where a vector's timeline says "the TTL elapses",
 *     the hook casts that endorsement, shifts `created_at` back, and invokes
 *     the REAL sweep entry (`autoMergeExpired`) — the same function the cron
 *     route calls.
 *
 * The one wire divergence the adapter carries for an EXISTING route: the
 * create response's `status` stays the KG's own `pending` (#5564 — never
 * re-typed), and the §5 protocol rendering is served additively as
 * `protocol_status`; the vector's `status: open` is asserted against that
 * key on exactly those steps (KEY_ALIASES). The new single-proposal read has
 * no such history and serves protocol vocabulary directly.
 *
 * Suite runs only with DATABASE_URL (CI: the kg-integration job's
 * postgres:16-alpine service container) — see db.itest.ts for the guard
 * rationale.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { v4 as uuid } from "uuid";
import type { NextRequest } from "next/server";
import type { DbClient } from "@/lib/db";
import type * as DbModule from "@/lib/db";
import { APPLY_ATTESTED_EVENT } from "@/lib/effect-class";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  process.stderr.write(
    "\n[execution-boundary.itest] DATABASE_URL is not set — SKIPPING the #5535 vector execution.\n" +
      "[execution-boundary.itest] It runs in CI against the kg-integration job's postgres:16-alpine service container.\n\n"
  );
}

const describeDb = DATABASE_URL ? describe : describe.skip;

/** Run-scoping suffix for seeded fabric/section ids (append-only doctrine). */
const RUN = `x${Date.now().toString(36)}`;

// ── The vendored vector fixture ─────────────────────────────────────────────

interface VectorStep {
  id: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
  expected_response: {
    status: number;
    body_match?: { mode: string; value: Record<string, unknown> };
  };
  cross_call_assertions?: { kind: string; body_path: string; match: Record<string, unknown> }[];
}

interface SessionVector {
  id: string;
  sha256: string;
  raw_yaml: string;
  parsed: {
    metadata: { id: string };
    preconditions: {
      server_state: {
        resource_id: string;
        effect_class: string;
        registered_agents: string[];
      };
    };
    steps: VectorStep[];
  };
}

interface Fixture {
  source: { commit: string };
  vectors: SessionVector[];
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "pact-v23", "execution-boundary-vectors.json"),
    "utf8"
  )
) as Fixture;

function vectorById(suffix: string): SessionVector {
  const found = fixture.vectors.find((v) => v.id.endsWith(suffix));
  if (!found) throw new Error(`fixture carries no vector ${suffix}`);
  return found;
}

const ttlVector = vectorById("ttl-automerge-creates-no-attestation");
const consensusVector = vectorById("consensus-contract-is-draft-not-signed");

// ── Auth substitution: the vector's own X-Pact-Principal header drives it ───

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAgent: async (req: NextRequest) => {
      const principal = req.headers.get("x-pact-principal");
      if (!principal) throw new Error("itest: request carries no X-Pact-Principal header");
      return { id: principal, name: principal };
    },
    checkAgentReputation: async () => ({ eligible: true }),
    checkReviewDuty: async () => ({ allowed: true, reviewsNeeded: 0, proposalsMade: 0, reviewsCast: 0 }),
    checkCivicDuty: async () => ({ allowed: true, votesNeeded: 0, topicsCreated: 0, votesCast: 0 }),
  };
});

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimit: async () => ({ allowed: true, remaining: 999, resetAt: Date.now() + 60_000 }),
    getRateLimitHeaders: () => ({}),
  };
});

// ── Pool tracker (same rationale + shape as db.itest.ts / kg-tx.itest.ts) ───
const RealPool = pg.Pool;
const trackedPools: InstanceType<typeof pg.Pool>[] = [];

function installPoolTracker(): void {
  class TrackedPool extends RealPool {
    constructor(...args: ConstructorParameters<typeof RealPool>) {
      super(...args);
      trackedPools.push(this);
    }
  }
  (pg as { Pool: typeof pg.Pool }).Pool = TrackedPool as typeof pg.Pool;
}

// ── Generic runner pieces ───────────────────────────────────────────────────

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function buildRequest(step: VectorStep, body: Record<string, unknown> | undefined): NextRequest {
  return new Request(`http://localhost${step.request.path}`, {
    method: step.request.method,
    headers: { "content-type": "application/json", ...(step.request.headers ?? {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest;
}

/** Recursively substitute bound symbolic ids inside expected values. */
function substitute(value: unknown, bindings: Map<string, string>): unknown {
  if (typeof value === "string") return bindings.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => substitute(v, bindings));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v, bindings)])
    );
  }
  return value;
}

/**
 * The vector's `body_match: { mode: subset }` semantics: every expected key
 * must be present and match; extra actual keys are ignored; nested objects
 * recurse; null means null.
 */
function collectSubsetFailures(
  actual: unknown,
  expected: unknown,
  at: string,
  failures: string[]
): void {
  if (expected === null) {
    if (actual !== null) failures.push(`${at}: expected null, got ${JSON.stringify(actual)}`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      failures.push(`${at}: expected array ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      return;
    }
    expected.forEach((entry, i) => collectSubsetFailures(actual[i], entry, `${at}[${i}]`, failures));
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      failures.push(`${at}: expected object, got ${JSON.stringify(actual)}`);
      return;
    }
    for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
      if (!(key in (actual as Record<string, unknown>))) {
        failures.push(`${at}.${key}: missing (§25 absence must be STATED, not elided)`);
        continue;
      }
      collectSubsetFailures((actual as Record<string, unknown>)[key], value, `${at}.${key}`, failures);
    }
    return;
  }
  if (actual !== expected) {
    failures.push(`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

describeDb("#5535 — execution-boundary session vectors against the real KG (real Postgres)", () => {
  let dbmod: typeof DbModule;
  let db: DbClient;

  let proposalsPost: Handler;
  let proposalGet: Handler;
  let approvePost: Handler;
  let donePost: Handler;
  let topicGet: Handler;
  let wellKnownGet: () => Promise<Response>;

  /**
   * Adaptation kinds 1 and 3 — where each vector path dispatches, and how
   * the request body is shaped for the KG's own validation gates.
   */
  interface Adapted {
    handler: () => Handler;
    params: (topicId: string, proposalId?: string) => Record<string, string>;
    /** Existing-route key aliases for expected-body matching (kind 3). */
    keyAliases?: Record<string, string>;
    /** Accepted success status when it differs from the vector's (kind 3). */
    acceptStatus?: Record<number, number>;
    shapeBody?: (
      body: Record<string, unknown>,
      bindings: Map<string, string>
    ) => Record<string, unknown>;
  }

  function adapt(method: string, vectorPath: string): { adapted: Adapted; topicId: string; proposalSymbol?: string } {
    let m: RegExpMatchArray | null;
    if (method === "GET" && /^\/\.well-known\/pact\.json$/.test(vectorPath)) {
      return {
        adapted: {
          handler: () => (async () => wellKnownGet()) as unknown as Handler,
          params: () => ({}),
        },
        topicId: "",
      };
    }
    if (method === "POST" && (m = vectorPath.match(/^\/api\/pact\/([^/]+)\/proposals$/))) {
      return {
        adapted: {
          handler: () => proposalsPost,
          params: (topicId) => ({ topicId }),
          // #5564 — the pre-existing create response keeps its own `status`
          // value (`pending`); the §5 rendering is additive. The vector's
          // `status` matches the additive key.
          keyAliases: { status: "protocol_status" },
          // The KG's create has always been 201 Created.
          acceptStatus: { 200: 201 },
          shapeBody: (body, bindings) => ({
            // The vector's symbolic section id resolves to this run's seeded
            // section (kind 2 — sections carry a global PK).
            sectionId: bindings.get(String(body.sectionId)) ?? body.sectionId,
            summary: body.summary,
            // The reference wire derives the edit's content; the KG requires
            // it (>= 50 substantive chars). Derived from the vector's own
            // summary so nothing here invents semantics.
            newContent:
              `Proposed edit (executed vector step): ${String(body.summary ?? "")}. ` +
              "This content is the draft text the proposal merges into the section.",
            // 30s validation floor; the elapse is driven by the TTL hook,
            // not by waiting.
            ttl: Math.max(Number(body.ttlSeconds ?? 300), 30),
          }),
        },
        topicId: m[1],
      };
    }
    if (method === "POST" && (m = vectorPath.match(/^\/api\/pact\/([^/]+)\/proposals\/([^/]+)\/approve$/))) {
      return {
        adapted: {
          handler: () => approvePost,
          params: (topicId, proposalId) => ({ topicId, proposalId: proposalId! }),
        },
        topicId: m[1],
        proposalSymbol: m[2],
      };
    }
    if (method === "GET" && (m = vectorPath.match(/^\/api\/pact\/([^/]+)\/proposals\/([^/]+)$/))) {
      return {
        adapted: {
          handler: () => proposalGet,
          params: (topicId, proposalId) => ({ topicId, proposalId: proposalId! }),
        },
        topicId: m[1],
        proposalSymbol: m[2],
      };
    }
    if (method === "POST" && (m = vectorPath.match(/^\/api\/pact\/([^/]+)\/done$/))) {
      return {
        adapted: {
          handler: () => donePost,
          params: (topicId) => ({ topicId }),
        },
        topicId: m[1],
      };
    }
    // Surface mapping (kind 1): `_status` and `manifest` are the topic read.
    if (method === "GET" && (m = vectorPath.match(/^\/api\/pact\/([^/]+)\/(_status|manifest)$/))) {
      return {
        adapted: {
          handler: () => topicGet,
          params: (topicId) => ({ topicId }),
        },
        topicId: m[1],
      };
    }
    throw new Error(`no adapter for ${method} ${vectorPath}`);
  }

  /** Engine hooks (kind 4), keyed by vector id suffix + step id. */
  type HookContext = { topicId: string; bindings: Map<string, string> };
  type Hook = (ctx: HookContext) => Promise<void>;

  function boundId(ctx: HookContext, symbol: string): string {
    const proposalId = ctx.bindings.get(symbol);
    if (!proposalId) throw new Error(`hook ran before ${symbol} was bound`);
    return proposalId;
  }

  /** The KG's Silence=Consent floor: at least one non-author endorsement. */
  async function endorse(ctx: HookContext, symbol: string, endorser: string): Promise<void> {
    const proposalId = boundId(ctx, symbol);
    const approveReq = new Request(
      `http://localhost/api/pact/${ctx.topicId}/proposals/${proposalId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-pact-principal": endorser },
        body: JSON.stringify({ decision: "approve" }),
      }
    ) as unknown as NextRequest;
    const approveRes = await approvePost(approveReq, {
      params: Promise.resolve({ topicId: ctx.topicId, proposalId }),
    });
    expect(approveRes.status).toBe(200);
  }

  /** The vector's "TTL elapses" — then the REAL sweep the cron routes call. */
  async function expireAndSweep(ctx: HookContext, symbol: string): Promise<void> {
    const proposalId = boundId(ctx, symbol);
    // With two registered agents the quorum bar is two non-author approvals,
    // so the single endorsement must NOT have merged it already — the merge
    // has to come from the sweep, or the vector proves nothing.
    const before = await db.execute({
      sql: "SELECT status FROM proposals WHERE id = ?",
      args: [proposalId],
    });
    expect(before.rows[0]?.status).toBe("pending");
    // The TTL elapses (created_at shifted past any permitted TTL)…
    await db.execute({
      sql: "UPDATE proposals SET created_at = created_at - INTERVAL '172800 seconds' WHERE id = ?",
      args: [proposalId],
    });
    await dbmod.autoMergeExpired(db);
  }

  const HOOKS: Record<string, Record<string, Hook>> = {
    "ttl-automerge-creates-no-attestation": {
      // Between the create and the read-back: beta's endorsement (the KG's
      // silence floor), then the elapse + sweep.
      "ttl-expires-auto-merged": async (ctx) => {
        await endorse(ctx, "prop_draft_edit", "did:web:beta.example");
        await expireAndSweep(ctx, "prop_draft_edit");
      },
    },
    "consensus-contract-is-draft-not-signed": {
      // Beta's endorsement is the vector's OWN approve step; with both
      // counterparties registered the KG's anti-rubber-stamp bar (two
      // non-author approvals) leaves the clause pending, and the merge
      // arrives on the same Silence=Consent path as the TTL vector.
      "alpha-done-aligned": (ctx) => expireAndSweep(ctx, "prop_confidentiality"),
    },
  };

  /**
   * Precondition seeding: the vector's server_state, on the KG's schema.
   *
   * APPEND-ONLY: nothing is deleted here. §6.4 forbids removing an event row
   * outside the retention seam (the provenance-chain G1 source guard
   * enforces that over this file too), so a re-run against a persistent
   * database seeds a FRESH run-suffixed fabric and binds the vector's
   * symbolic resource_id to it instead of tearing the previous run's rows
   * down. Agents are the vectors' literal principals, upserted idempotently.
   */
  async function seedVector(
    vector: SessionVector,
    options: { sectionId: string; sectionHeading: string; conventionStop: boolean },
    bindings: Map<string, string>
  ): Promise<string> {
    const state = vector.parsed.preconditions.server_state;
    const topicId = `${state.resource_id}-${RUN}`;
    bindings.set(state.resource_id, topicId);

    await db.execute({
      sql: "INSERT INTO topics (id, title, content, tier, status) VALUES (?, ?, ?, 'practice', 'open')",
      args: [topicId, topicId, `seeded fabric for executed vector ${vector.id}`],
    });
    if (options.conventionStop) {
      // The vector's two-counterparty unanimous policy maps onto the KG's
      // two-party ratification floor (CONVENTION_STOP_BASE_AGENTS = 2); the
      // per-tier floors all require ≥3 participants.
      await db.execute({ sql: "UPDATE topics SET convention_stop = 1 WHERE id = ?", args: [topicId] });
    }
    // Sections carry a GLOBAL primary key, so the vector's section id is
    // run-suffixed and bound the same way the fabric id is.
    const sectionId = `${options.sectionId}-${RUN}`;
    bindings.set(options.sectionId, sectionId);
    await db.execute({
      sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, ?, 2, '', 0)",
      args: [sectionId, topicId, options.sectionHeading],
    });

    for (const principal of state.registered_agents) {
      await db.execute({
        sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
        args: [principal, principal, `itest-key-${principal}`],
      });
      await db.execute({
        sql: "INSERT INTO agent_wallets (agent_id, balance) VALUES (?, 100) ON CONFLICT (agent_id) DO UPDATE SET balance = 100",
        args: [principal],
      });
      // assumptions_declared = 1: the KG's assumption QA gate is satisfied
      // as a precondition (request shaping, kind 3) — the vectors' done
      // bodies carry no KG assumption declarations.
      await db.execute({
        sql: "INSERT INTO registrations (id, topic_id, agent_id, assumptions_declared) VALUES (?, ?, ?, 1) ON CONFLICT (topic_id, agent_id) DO NOTHING",
        args: [uuid(), topicId, principal],
      });
    }
    return topicId;
  }

  /** Run one vector: every step, in order, from the fixture. */
  async function runVector(vector: SessionVector, bindings: Map<string, string>): Promise<void> {
    const hooks = HOOKS[vector.id.split("/").pop() ?? ""] ?? {};

    for (const step of vector.parsed.steps) {
      const { adapted, topicId: vectorTopicId, proposalSymbol } = adapt(
        step.request.method,
        step.request.path
      );
      // Kind-2 binding: the vector's symbolic fabric id resolves to this
      // run's seeded topic.
      const topicId = bindings.get(vectorTopicId) ?? vectorTopicId;

      const hook = hooks[step.id];
      if (hook) await hook({ topicId, bindings });

      const boundProposalId = proposalSymbol ? bindings.get(proposalSymbol) ?? proposalSymbol : undefined;
      const body = step.request.body
        ? adapted.shapeBody
          ? adapted.shapeBody(step.request.body, bindings)
          : step.request.body
        : undefined;
      const handler = adapted.handler();
      const response = await handler(buildRequest(step, body), {
        params: Promise.resolve(adapted.params(topicId, boundProposalId)),
      });

      const expectedStatus = step.expected_response.status;
      const acceptedStatus = adapted.acceptStatus?.[expectedStatus] ?? expectedStatus;
      expect(response.status, `${vector.id} / ${step.id}: HTTP status`).toBe(acceptedStatus);

      const actual = (await response.json()) as Record<string, unknown>;

      // Id binding (kind 2): the create step binds the vector's symbolic
      // proposal id to the id the KG minted.
      const symbolic = step.request.body?.proposalId;
      if (typeof symbolic === "string" && typeof actual.proposalId === "string") {
        bindings.set(symbolic, actual.proposalId);
      }

      if (step.expected_response.body_match) {
        expect(step.expected_response.body_match.mode).toBe("subset");
        let expectedValue = substitute(
          step.expected_response.body_match.value,
          bindings
        ) as Record<string, unknown>;
        if (adapted.keyAliases) {
          expectedValue = Object.fromEntries(
            Object.entries(expectedValue).map(([k, v]) => [adapted.keyAliases![k] ?? k, v])
          );
        }
        const failures: string[] = [];
        collectSubsetFailures(actual, expectedValue, `${step.id}.body`, failures);
        expect(failures, `${vector.id} / ${step.id}`).toEqual([]);
      }

      for (const obligation of step.cross_call_assertions ?? []) {
        expect(obligation.kind).toBe("negative_obligation");
        // An empty `match` block matches ANY entry — the collection must be
        // both PRESENT (the absence is stated, §25.4) and EMPTY.
        const collection = actual[obligation.body_path];
        expect(
          Array.isArray(collection),
          `${vector.id} / ${step.id}: ${obligation.body_path} must be reported`
        ).toBe(true);
        expect(collection, `${vector.id} / ${step.id}: ${obligation.body_path}`).toEqual([]);
      }
    }

    // Postcondition (both vectors): no attestation event of any kind was
    // emitted for the fabric — §25.9's decisive negative.
    const symbolicFabricId = vector.parsed.preconditions.server_state.resource_id;
    const topicId = bindings.get(symbolicFabricId) ?? symbolicFabricId;
    const attested = await db.execute({
      sql: "SELECT COUNT(*) as n FROM events WHERE topic_id = ? AND type = ?",
      args: [topicId, APPLY_ATTESTED_EVENT],
    });
    expect(Number(attested.rows[0]?.n ?? 0)).toBe(0);
  }

  beforeAll(async () => {
    installPoolTracker();
    dbmod = await import("@/lib/db");
    db = await dbmod.getDb();

    // Route modules type their params to the exact segment shape; the
    // dispatch table is generic over them, so each handler is widened once
    // here (the adapters always supply the segments the route declares).
    proposalsPost = (await import("@/app/api/pact/[topicId]/proposals/route")).POST as unknown as Handler;
    proposalGet = (await import("@/app/api/pact/[topicId]/proposals/[proposalId]/route")).GET as unknown as Handler;
    approvePost = (await import("@/app/api/pact/[topicId]/proposals/[proposalId]/approve/route")).POST as unknown as Handler;
    donePost = (await import("@/app/api/pact/[topicId]/done/route")).POST as unknown as Handler;
    topicGet = (await import("@/app/api/pact/[topicId]/route")).GET as unknown as Handler;
    wellKnownGet = (await import("@/app/.well-known/pact.json/route")).GET;

    // The proposal stake moves credits to the protocol wallet — make sure it
    // exists whatever state the container is in.
    await db.execute({
      sql: "INSERT INTO agents (id, name, api_key) VALUES ('hub-protocol', 'hub-protocol', 'itest-key-hub-protocol') ON CONFLICT (id) DO NOTHING",
      args: [],
    });
    await db.execute({
      sql: "INSERT INTO agent_wallets (agent_id, balance) VALUES ('hub-protocol', 0) ON CONFLICT (agent_id) DO NOTHING",
      args: [],
    });
  });

  afterAll(async () => {
    await Promise.all(trackedPools.map((pool) => pool.end().catch(() => undefined)));
  });

  it("carries the pinned vectors verbatim — the SHA-256 recomputes from the vendored YAML", () => {
    for (const vector of [ttlVector, consensusVector]) {
      const recomputed = crypto.createHash("sha256").update(vector.raw_yaml, "utf8").digest("hex");
      expect(recomputed, vector.id).toBe(vector.sha256);
    }
  });

  it("executes ttl-automerge-creates-no-attestation end-to-end (§25.3, §25.4, §25.8)", async () => {
    const bindings = new Map<string, string>();
    await seedVector(
      ttlVector,
      { sectionId: "sec:summary", sectionHeading: "Summary", conventionStop: false },
      bindings
    );
    await runVector(ttlVector, bindings);
  });

  it("executes consensus-contract-is-draft-not-signed end-to-end (§25.8, §25.10, §15.1)", async () => {
    const bindings = new Map<string, string>();
    await seedVector(
      consensusVector,
      {
        // The KG's promotion gate counts merged proposals on the Answer
        // section; the vector's own section id is preserved (bound), the
        // heading is the KG's convention.
        sectionId: "sec:confidentiality",
        sectionHeading: "Answer",
        conventionStop: true,
      },
      bindings
    );
    await runVector(consensusVector, bindings);
  });
});
