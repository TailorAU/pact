/**
 * au.tailor.pact/mandate — MCP extension guard for @pact-protocol/mcp.
 *
 * Design record: docs/v2-prep/rfc-mcp-mandate-extension.md (merged via PR #40).
 * Mandate primitive: RFC #14 (ACCEPT-WITH-MODIFICATIONS, 2026-05-16 — the
 * Parley RFC; normative §19–20 text is #35 / spec/v2.1). The mandate body is
 * carried VERBATIM from RFC #14 under _meta["au.tailor.pact/mandate"] — this
 * module adds no fields to it. Escalation-retry material (request_state +
 * authorization_proof) travels under the SIBLING key
 * _meta["au.tailor.pact/mandate-escalation"], so the mandate key's value is
 * never polluted.
 *
 * What this guard does, per request, when enforcement is configured:
 *   1. Reads the mandate from _meta["au.tailor.pact/mandate"].
 *   2. Verifies it structurally (fields, DID shape, expiry against the server
 *      clock, registry tombstone/enrollment/revocation when a registry is
 *      configured — enrollment is FAIL-CLOSED: an unenrolled signing key is
 *      rejected, otherwise revocation would be bypassable by renaming the
 *      key). Cryptographic signature verification is type-defined and
 *      deliberately NOT performed here — the same explicit deferral as
 *      `pact verify-proof` and the conformance runner's non-crypto paths.
 *      Every verdict carries verification: "structural" so no consumer can
 *      read it as cryptographic.
 *   3. Evaluates the call against the envelope in §8 order: constraint
 *      envelope (category), commitment authority, disclosure ceiling.
 *   4. Exceeding commitment_authority is NOT an error: the call suspends with
 *      an emulated Multi Round-Trip Request result carrying a per-escalation
 *      challenge_nonce. The retry's §17.6 authorization_proof MUST echo that
 *      nonce (§17.7 step 5(a) binding — this is what makes approvals
 *      single-use against byte-identical proof replay). The approval is
 *      consumed, and the binding-decision counter committed, only when the
 *      underlying call SUCCEEDS — a transient upstream failure does not burn
 *      a human approval.
 *   5. Stamps every result's _meta with a verdict; in observed mode the
 *      verdict records violations instead of blocking (a denied call must
 *      never be indistinguishable from a clean pass in the audit trail).
 *
 * SDK note: @modelcontextprotocol/sdk 1.x predates the 2026-07-28 MCP
 * revision, so two surfaces are emulated and documented as such:
 *   - JSON-RPC extension error codes (-32010..-32019) ride inside the house
 *     isError content + result._meta, not as protocol-level errors.
 *   - input_required is a structured tool result, not a first-class
 *     resultType. Both migrate mechanically when the SDK lands 2026-07-28.
 * Also: the SDK strips arguments a tool's schema does not declare BEFORE the
 * guard runs. Argument-based checks (category, disclosure_level) therefore
 * reach exactly the tools whose schemas declare those parameters — see
 * REACH.md-style notes in Appendix B of the design record. Do not add an
 * argument-based check without declaring the argument.
 *
 * Ratified decisions honoured (rfc-14-shepherd-synthesis.yaml):
 *   - SOQ2: clock skew reuses §17.7's ±5-minute (300 s) default. Applied to
 *     the retry proof's asserted_at (a real §17.6 field). The RFC #14
 *     Mandate shape has no client-time field, so no skew check is applied to
 *     the mandate body itself — inventing one would violate verbatim
 *     carriage.
 *   - OQ1: revocation is immediate — per-request verification, and the
 *     registry file is re-read on every verification, never cached.
 * Open-question implementation defaults (flagged, not settled):
 *   - Q2: binding_scope is advisory at this boundary — noted, never the sole
 *     rejection ground.
 *   - Q3: enforcement is server-authoritative at this boundary.
 *
 * Honest limits (also stated in the design record):
 *   - This is a stdio proxy the CLIENT launches. In-process counters
 *     (binding decisions, pending escalations) reset if the client restarts
 *     the process, so max_binding_decisions is advisory against an adversary
 *     who owns the process. Counters are keyed by the mandate body's digest,
 *     not the client-chosen session_id, so a client cannot reset them by
 *     rotating session_id alone.
 *
 * Config (env):
 *   PACT_MANDATE_ENFORCEMENT   unset → guard disabled (backward compatible);
 *                              "required" | "optional" | "observed"
 *   PACT_MANDATE_CLOCK_SKEW_SECONDS  default 300 (§17.7 / SOQ2)
 *   PACT_MANDATE_REGISTRY      path to a principal-registry.json (the
 *                              `pact verify-proof --registry` shape),
 *                              re-read per verification
 *   PACT_MANDATE_BINDING_TOOLS csv override of binding-decision tools
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const MANDATE_EXTENSION_ID = 'au.tailor.pact/mandate';
/** Sibling _meta key for escalation retries AND the inputRequests type. */
export const ESCALATION_META_ID = 'au.tailor.pact/mandate-escalation';

export type Enforcement = 'required' | 'optional' | 'observed';

/** RFC §11 error table (implementation-defined JSON-RPC range -32000..-32019). */
export const MANDATE_ERRORS = {
  MandateRequired: -32010,
  MandateInvalidSignature: -32011,
  MandateExpired: -32012,
  MandateRevoked: -32013,
  MandateCategoryDenied: -32014,
  MandateDisclosureExceeded: -32015,
  MandateDigestUnknown: -32016,
  MandateClockSkew: -32017,
  MandateEscalationUnknown: -32018,
  MandateProofRejected: -32019,
} as const;
export type MandateErrorName = keyof typeof MANDATE_ERRORS;

/**
 * Tools whose schemas declare a `category` argument — the only tools where
 * may_publish is enforceable at this boundary. Under a mandate that scopes
 * may_publish, these tools REQUIRE a category (fail closed): an agent can
 * always supply one, and permitting uncategorised publishes would make the
 * strictest expressible mandate restrict nothing.
 */
const CATEGORY_TOOLS = new Set(['pact_intent', 'pact_constrain']);

/**
 * Tools whose schemas declare a `disclosure_level` argument (§10.3 levels
 * 1–4) — the only tools where disclosure_ceiling is enforceable here.
 */
const DISCLOSURE_TOOLS = new Set(['pact_escalate', 'pact_ask']);

/** Default binding-decision tools (overridable via PACT_MANDATE_BINDING_TOOLS). */
const DEFAULT_BINDING_TOOLS = [
  'pact_done',
  'pact_lock',
  'pact_matter_close',
  'pact_matter_add_member',
  'pact_matter_attach',
  'pact_matter_detach',
];

const ESCALATION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_ESCALATIONS = 32;
const MAX_DIGEST_CACHE = 64;

interface Mandate {
  version?: unknown;
  session_id?: unknown;
  agent_id?: unknown;
  handler_principal_id?: unknown;
  identity_claim?: unknown;
  constraint_envelope?: {
    may_publish?: unknown;
    must_respect?: unknown;
  };
  commitment_authority?: {
    max_binding_decisions?: unknown;
    binding_scope?: unknown;
  };
  disclosure_ceiling?: unknown;
  escalation_hook?: unknown;
  expires_at?: unknown;
  signature?: unknown;
  signing_key_id?: unknown;
  [key: string]: unknown;
}

interface RegistryCredential {
  id?: string;
  revoked?: boolean;
}
interface RegistryPrincipal {
  id?: string;
  tombstoned_at?: string | null;
  credentials?: RegistryCredential[];
}
interface Registry {
  principals?: RegistryPrincipal[];
}

interface Config {
  enforcement: Enforcement | null;
  clockSkewMs: number;
  registryPath: string | null;
  bindingTools: Set<string>;
}

let cachedConfig: Config | null = null;

function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;
  const raw = (process.env.PACT_MANDATE_ENFORCEMENT ?? '').trim().toLowerCase();
  let enforcement: Enforcement | null = null;
  if (raw === 'required' || raw === 'optional' || raw === 'observed') enforcement = raw;
  else if (raw !== '') {
    throw new Error(
      `PACT_MANDATE_ENFORCEMENT must be "required", "optional" or "observed" (got "${raw}").`,
    );
  }
  const skewSeconds = Number(process.env.PACT_MANDATE_CLOCK_SKEW_SECONDS ?? '300');
  const clockSkewMs = Number.isFinite(skewSeconds) && skewSeconds >= 0 ? skewSeconds * 1000 : 300_000;
  const bindingCsv = process.env.PACT_MANDATE_BINDING_TOOLS;
  const bindingTools = new Set(
    bindingCsv ? bindingCsv.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_BINDING_TOOLS,
  );
  cachedConfig = {
    enforcement,
    clockSkewMs,
    registryPath: process.env.PACT_MANDATE_REGISTRY ?? null,
    bindingTools,
  };
  return cachedConfig;
}

/**
 * Registry is re-read on every verification, never cached: revocation must
 * take effect on the very next request (ratified RFC #14 OQ1). Registry
 * files are small; a per-call read on a local stdio proxy is the correct
 * trade. Throws on read/parse failure — callers translate per mode.
 */
function loadRegistry(cfg: Config): Registry | null {
  if (!cfg.registryPath) return null;
  const parsed = JSON.parse(readFileSync(cfg.registryPath, 'utf8')) as Registry;
  if (!Array.isArray(parsed.principals)) {
    throw new Error('registry file must contain a "principals" array');
  }
  return parsed;
}

/** Test seam. */
export function resetMandateStateForTests(): void {
  cachedConfig = null;
  mandateByDigest.clear();
  pendingEscalations.clear();
  bindingDecisionsUsed.clear();
}

// ── In-process state ─────────────────────────────────────────────
// Stdio proxy: one process per client session. Caches and counters, never a
// protocol-level session. All three collections are bounded; see the honest
// limits note in the header for what process restarts mean.

/** Digest mode (RFC §6): VERIFIED mandate bodies only, keyed by SHA-256. */
const mandateByDigest = new Map<string, { mandate: Mandate; expiresAtMs: number }>();

interface PendingEscalation {
  mandateDigest: string;
  tool: string;
  argsDigest: string;
  challengeNonce: string;
  detail: Record<string, unknown>;
  createdAt: number;
}
const pendingEscalations = new Map<string, PendingEscalation>();

/** Binding decisions consumed, keyed by mandate-body digest (not session_id). */
const bindingDecisionsUsed = new Map<string, { count: number; expiresAtMs: number }>();

/** Deterministic JSON stringify (sorted keys) — digest/cache key only, not a crypto claim. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sweepState(now: number): void {
  for (const [key, entry] of pendingEscalations) {
    if (now - entry.createdAt > ESCALATION_TTL_MS) pendingEscalations.delete(key);
  }
  for (const [key, entry] of mandateByDigest) {
    if (now > entry.expiresAtMs) mandateByDigest.delete(key);
  }
  for (const [key, entry] of bindingDecisionsUsed) {
    if (now > entry.expiresAtMs) bindingDecisionsUsed.delete(key);
  }
}

function evictOldest<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

// ── Result shapes (house style: isError content, never a throw) ──

interface TextContent {
  type: 'text';
  text: string;
}
export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Violation {
  name: MandateErrorName;
  code: number;
  detail: string;
}

function violation(name: MandateErrorName, detail: string): Violation {
  return { name, code: MANDATE_ERRORS[name], detail };
}

function mandateErrorResult(v: Violation, sessionId?: string): ToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: [${MANDATE_EXTENSION_ID}] ${v.name} (${v.code}): ${v.detail}`,
      },
    ],
    isError: true,
    _meta: {
      [MANDATE_EXTENSION_ID]: {
        verified: false,
        verification: 'structural',
        error: { name: v.name, code: v.code },
        ...(sessionId ? { session_id: sessionId } : {}),
      },
    },
  };
}

// ── Verification (RFC §7 — structural; crypto deferred like verify-proof) ──

interface VerifyOutcome {
  mandate?: Mandate;
  /** SHA-256 of the canonical mandate body — counter/cache key. */
  digest?: string;
  failure?: Violation;
  notes: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function verifyMandate(metaValue: unknown, cfg: Config, now: number): VerifyOutcome {
  const notes: string[] = [];
  if (typeof metaValue !== 'object' || metaValue === null) {
    return { notes, failure: violation('MandateRequired', 'mandate _meta value is not an object.') };
  }
  let mandate = metaValue as Mandate;
  let digest: string;

  // Digest mode (RFC §6): { session_id, digest } after first full send.
  if (!('version' in mandate) && isNonEmptyString(mandate.digest)) {
    const cached = mandateByDigest.get(mandate.digest);
    if (!cached) {
      return {
        notes,
        failure: violation(
          'MandateDigestUnknown',
          `no cached mandate for digest ${String(mandate.digest).slice(0, 16)}…; retry with the full mandate body.`,
        ),
      };
    }
    notes.push('digest mode: mandate body resolved from cache');
    mandate = cached.mandate;
    digest = String((metaValue as Mandate).digest);
  } else {
    digest = sha256Hex(canonicalJson(mandate));
  }

  const sessionId = isNonEmptyString(mandate.session_id) ? mandate.session_id : undefined;
  const fail = (v: Violation): VerifyOutcome => ({ notes, failure: v, mandate, digest });

  // Required fields (RFC #14 mandate shape, carried verbatim — no additions).
  for (const field of [
    'version',
    'session_id',
    'agent_id',
    'handler_principal_id',
    'expires_at',
    'signature',
    'signing_key_id',
  ]) {
    const value = mandate[field];
    if (!isNonEmptyString(value) && typeof value !== 'number') {
      return fail(violation('MandateInvalidSignature', `mandate is missing required field "${field}" — cannot verify.`));
    }
  }

  if (!/^did:[a-z0-9]+:.+/.test(String(mandate.handler_principal_id))) {
    return fail(
      violation('MandateInvalidSignature', `handler_principal_id "${String(mandate.handler_principal_id)}" is not a DID.`),
    );
  }

  // Expiry — server clock is authoritative (RFC #14 Q6, ratified). The RFC #14
  // Mandate shape has no client-time field, so no skew check applies to the
  // body itself; -32017 fires on retry-proof freshness instead (§9).
  const expiresMs = Date.parse(String(mandate.expires_at));
  if (!Number.isFinite(expiresMs)) {
    return fail(violation('MandateExpired', `expires_at "${String(mandate.expires_at)}" is not ISO 8601.`));
  }
  if (now > expiresMs) {
    return fail(
      violation(
        'MandateExpired',
        `mandate expired at ${String(mandate.expires_at)} (server time ${new Date(now).toISOString()}).`,
      ),
    );
  }

  // Registry checks (per-verification read; see loadRegistry).
  let registry: Registry | null = null;
  let registryUnavailable = false;
  try {
    registry = loadRegistry(cfg);
  } catch (err) {
    // Fail closed in enforcing modes; observed records and proceeds. No
    // filesystem paths in client-visible text — details go to stderr.
    console.error(`[${MANDATE_EXTENSION_ID}] registry read failed:`, err instanceof Error ? err.message : err);
    registryUnavailable = true;
  }
  if (registryUnavailable) {
    if (cfg.enforcement === 'observed') {
      notes.push('principal registry unavailable — checks skipped (observed mode)');
    } else {
      return fail(violation('MandateInvalidSignature', 'principal registry unavailable — failing closed.'));
    }
  } else if (registry) {
    const principalId = String(mandate.handler_principal_id);
    const principal = (registry.principals ?? []).find((p) => p.id === principalId);
    if (!principal) {
      return fail(violation('MandateInvalidSignature', `principal ${principalId} not found in registry.`));
    }
    if (principal.tombstoned_at) {
      return fail(violation('MandateRevoked', `principal ${principalId} is tombstoned (${principal.tombstoned_at}).`));
    }
    const signingKeyId = String(mandate.signing_key_id);
    const fragment = signingKeyId.includes('#') ? signingKeyId.slice(signingKeyId.indexOf('#') + 1) : signingKeyId;
    const credential = (principal.credentials ?? []).find((c) => c.id === signingKeyId || c.id === fragment);
    if (!credential) {
      // FAIL CLOSED: treating an unenrolled key as "unverifiable, proceed"
      // would let a client bypass revocation by renaming the key fragment.
      return fail(violation('MandateInvalidSignature', `signing key ${signingKeyId} is not enrolled for ${principalId}.`));
    }
    if (credential.revoked) {
      return fail(violation('MandateRevoked', `signing key ${signingKeyId} is revoked.`));
    }
    notes.push('principal resolved; signing key enrolled and not revoked');
  } else {
    notes.push('no registry configured — principal/revocation checks skipped');
  }

  notes.push(
    'signature present; cryptographic verification is type-defined and not performed by this guard (same deferral as pact verify-proof / conformance runner T9)',
  );

  // Cache VERIFIED bodies only — rejected garbage must not occupy the cache.
  if (!mandateByDigest.has(digest)) {
    mandateByDigest.set(digest, { mandate, expiresAtMs: expiresMs });
    evictOldest(mandateByDigest, MAX_DIGEST_CACHE);
  }

  return { mandate, digest, notes };
}

// ── Envelope evaluation (RFC §8 — category, commitment, disclosure, in order) ──

interface EnvelopeOutcome {
  failure?: Violation;
  escalation?: ToolResult;
  /** Observed-mode record of the escalation that would have been raised. */
  suppressedEscalation?: Record<string, unknown>;
  notes: string[];
  /** True when this call is a binding decision that should commit on success. */
  bindingDecision?: boolean;
}

function evaluateEnvelope(
  toolName: string,
  args: Record<string, unknown>,
  mandate: Mandate,
  mandateDigest: string,
  cfg: Config,
  now: number,
  opts: { skipCommitment: boolean; observed: boolean },
): EnvelopeOutcome {
  const notes: string[] = [];

  // 1. Constraint envelope — category membership where the tool declares one.
  const mayPublish = mandate.constraint_envelope?.may_publish;
  if (Array.isArray(mayPublish) && CATEGORY_TOOLS.has(toolName)) {
    const category = args['category'];
    if (!isNonEmptyString(category)) {
      return {
        notes,
        failure: violation(
          'MandateCategoryDenied',
          `${toolName} requires an explicit category under a mandate that scopes may_publish — uncategorised publishes would make the envelope unenforceable.`,
        ),
      };
    }
    if (!mayPublish.map(String).includes(category)) {
      return {
        notes,
        failure: violation(
          'MandateCategoryDenied',
          `category "${category}" is not in the mandate's may_publish list [${mayPublish.map(String).join(', ')}].`,
        ),
      };
    }
    notes.push(`category "${category}" permitted by may_publish`);
  }
  const mustRespect = mandate.constraint_envelope?.must_respect;
  if (Array.isArray(mustRespect) && mustRespect.length > 0) {
    // RFC §8: natural-language boundaries are carried, NOT machine-enforced.
    notes.push(
      `${mustRespect.length} must_respect boundar${mustRespect.length === 1 ? 'y' : 'ies'} carried, not machine-enforced`,
    );
  }

  // 2. Commitment authority — exceeding it escalates, never errors (§8/§9).
  let bindingDecision = false;
  if (!opts.skipCommitment && cfg.bindingTools.has(toolName)) {
    bindingDecision = true;
    const authority = mandate.commitment_authority;
    const max = typeof authority?.max_binding_decisions === 'number' ? authority.max_binding_decisions : null;
    const used = bindingDecisionsUsed.get(mandateDigest)?.count ?? 0;
    const scope = isNonEmptyString(authority?.binding_scope) ? authority?.binding_scope : undefined;
    if (scope) {
      // Q2 default: advisory at this boundary — noted, never the sole rejection ground.
      notes.push(`binding_scope "${scope}" is advisory at this MCP boundary (open question 2 default)`);
    }
    if (max !== null && used >= max) {
      const detail = {
        requested: `binding decision via ${toolName}`,
        binding_scope: scope ?? null,
        max_binding_decisions: max,
        decisions_used: used,
      };
      if (opts.observed) {
        // Observed mode records the would-be escalation and mutates nothing.
        return { notes, suppressedEscalation: { reason: 'commitment_authority_exceeded', ...detail }, bindingDecision };
      }
      sweepState(now);
      const requestState = `esc_${randomUUID()}`;
      const challengeNonce = randomUUID();
      pendingEscalations.set(requestState, {
        mandateDigest,
        tool: toolName,
        argsDigest: sha256Hex(canonicalJson(args)),
        challengeNonce,
        detail,
        createdAt: now,
      });
      evictOldest(pendingEscalations, MAX_PENDING_ESCALATIONS);
      const payload = {
        resultType: 'input_required',
        inputRequests: [
          {
            type: ESCALATION_META_ID,
            reason: 'commitment_authority_exceeded',
            detail,
            requires: 'authorization_proof',
            challenge_nonce: challengeNonce,
            escalation_hook_notified: false,
          },
        ],
        requestState,
        retry:
          `Re-invoke ${toolName} with identical arguments and the same mandate, adding ` +
          `_meta["${ESCALATION_META_ID}"] = { "request_state": "${requestState}", "authorization_proof": { …§17.6 envelope with challenge_nonce "${challengeNonce}"… } }. ` +
          'The proof must come from the mandate\'s handler and echo this challenge_nonce; approvals are single-use.',
        note:
          'Emulated Multi Round-Trip Request: @modelcontextprotocol/sdk 1.x predates resultType "input_required" (MCP 2026-07-28); this structured result carries the same contract.',
      };
      // escalation_hook delivery is PACT push delivery (§21, T4) — not wired
      // at this boundary; the flag above says so truthfully.
      return {
        notes,
        bindingDecision,
        escalation: {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          _meta: {
            [MANDATE_EXTENSION_ID]: {
              session_id: isNonEmptyString(mandate.session_id) ? mandate.session_id : undefined,
              verification: 'structural',
              escalation: { requestState, reason: 'commitment_authority_exceeded', ...detail },
            },
          },
        },
      };
    }
  }

  // 3. Disclosure ceiling — enforceable only where the tool declares the level.
  const ceiling = mandate.disclosure_ceiling;
  if (typeof ceiling === 'number' && DISCLOSURE_TOOLS.has(toolName)) {
    const level = args['disclosure_level'];
    if (typeof level === 'number' && level > ceiling) {
      return {
        notes,
        bindingDecision,
        failure: violation(
          'MandateDisclosureExceeded',
          `disclosure_level ${level} exceeds the mandate's disclosure_ceiling ${ceiling} (§10.3 levels 1–4); redaction is impossible at this boundary, so the call is refused.`,
        ),
      };
    }
  }

  return { notes, bindingDecision };
}

// ── Escalation retry (RFC §9) — validate only; consumption happens on success ──

interface RetryOutcome {
  failure?: Violation;
  /** Set when a pending escalation was validly approved for THIS call. */
  approvedState?: string;
  notes: string[];
}

function validateEscalationRetry(
  toolName: string,
  args: Record<string, unknown>,
  mandate: Mandate,
  mandateDigest: string,
  escMeta: Record<string, unknown> | undefined,
  cfg: Config,
  now: number,
): RetryOutcome {
  const notes: string[] = [];
  if (!escMeta) return { notes };
  const requestState = escMeta['request_state'];
  const proof = escMeta['authorization_proof'];
  if (!isNonEmptyString(requestState) || typeof proof !== 'object' || proof === null) {
    return { notes };
  }
  sweepState(now);
  const pending = pendingEscalations.get(requestState);
  if (!pending) {
    return {
      notes,
      failure: violation(
        'MandateEscalationUnknown',
        `request_state "${requestState}" is unknown, expired, or already consumed (escalations are single-use; TTL ${ESCALATION_TTL_MS / 60000} minutes).`,
      ),
    };
  }
  if (
    pending.mandateDigest !== mandateDigest ||
    pending.tool !== toolName ||
    pending.argsDigest !== sha256Hex(canonicalJson(args))
  ) {
    return {
      notes,
      failure: violation(
        'MandateEscalationUnknown',
        'escalation retry must re-invoke the same tool with identical arguments under the same mandate.',
      ),
    };
  }
  // §17.6 structural verification of the proof (crypto deferred, as everywhere).
  const p = proof as Record<string, unknown>;
  for (const field of ['type', 'principal_id', 'credential_id', 'challenge_nonce', 'asserted_at', 'signature']) {
    if (!isNonEmptyString(p[field])) {
      return { notes, failure: violation('MandateProofRejected', `authorization_proof is missing "${field}".`) };
    }
  }
  const proofType = String(p['type']);
  if (proofType !== 'fido2-assertion' && proofType !== 'voice-biometric' && !/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(proofType)) {
    return { notes, failure: violation('MandateProofRejected', `authorization_proof type "${proofType}" is not recognised (§18).`) };
  }
  if (String(p['principal_id']) !== String(mandate.handler_principal_id)) {
    return {
      notes,
      failure: violation(
        'MandateProofRejected',
        `authorization_proof principal ${String(p['principal_id'])} does not match the mandate's handler ${String(mandate.handler_principal_id)}.`,
      ),
    };
  }
  // §17.7 step 5(a): the proof MUST echo the per-escalation challenge nonce.
  // This is the replay barrier — a byte-identical proof from an earlier
  // escalation carries the wrong nonce and is rejected.
  if (String(p['challenge_nonce']) !== pending.challengeNonce) {
    return {
      notes,
      failure: violation(
        'MandateProofRejected',
        'authorization_proof challenge_nonce does not match the nonce issued with this escalation (§17.7 step 5 replay protection).',
      ),
    };
  }
  const assertedMs = Date.parse(String(p['asserted_at']));
  if (!Number.isFinite(assertedMs) || Math.abs(now - assertedMs) > cfg.clockSkewMs) {
    return {
      notes,
      failure: violation(
        'MandateClockSkew',
        `authorization_proof asserted_at is outside the ±${cfg.clockSkewMs / 1000}s freshness window (§17.7 step 4).`,
      ),
    };
  }
  // Registry checks on the APPROVER's credential — revoking the human's
  // credential must kill escalation approvals too (fail closed, like §7).
  let registry: Registry | null = null;
  try {
    registry = loadRegistry(cfg);
  } catch (err) {
    console.error(`[${MANDATE_EXTENSION_ID}] registry read failed during retry:`, err instanceof Error ? err.message : err);
    return { notes, failure: violation('MandateProofRejected', 'principal registry unavailable — failing closed.') };
  }
  if (registry) {
    const principal = (registry.principals ?? []).find((pr) => pr.id === String(p['principal_id']));
    if (!principal) {
      return { notes, failure: violation('MandateProofRejected', `approver ${String(p['principal_id'])} not found in registry.`) };
    }
    if (principal.tombstoned_at) {
      return { notes, failure: violation('MandateProofRejected', `approver ${String(p['principal_id'])} is tombstoned.`) };
    }
    const credId = String(p['credential_id']);
    const cred = (principal.credentials ?? []).find((c) => c.id === credId);
    if (!cred) {
      return { notes, failure: violation('MandateProofRejected', `approver credential ${credId} is not enrolled.`) };
    }
    if (cred.revoked) {
      return { notes, failure: violation('MandateProofRejected', `approver credential ${credId} is revoked.`) };
    }
    notes.push('approver principal resolved; credential enrolled and not revoked');
  }
  notes.push(
    `escalation ${requestState} approved by ${String(p['principal_id'])} via ${proofType} proof ` +
      '(structural verification; crypto type-defined) — consumed on success',
  );
  return { approvedState: requestState, notes };
}

// ── Public surface ───────────────────────────────────────────────

/**
 * ServerOptions for McpServer construction. Declares the extension under
 * ServerCapabilities.extensions when enforcement is configured (RFC §5).
 * SDK 1.x has no typed `extensions` member; the capabilities schema passes
 * unknown keys through, so this is a declared-shape cast, not a hack around
 * validation.
 */
export function mandateServerOptions(): { capabilities: Record<string, unknown> } | undefined {
  const cfg = loadConfig();
  if (!cfg.enforcement) return undefined;
  return {
    capabilities: {
      extensions: {
        [MANDATE_EXTENSION_ID]: {
          // The Mandate shape accepted is the RFC #14 shape; its normative
          // home (spec/v2.1 §19–20, #35) is unauthored, hence the -draft tag.
          specVersion: '2.1-draft',
          enforcement: cfg.enforcement,
          acceptedSigningAlgs: [],
          digestMode: true,
          maxClockSkewMs: cfg.clockSkewMs,
          note:
            'acceptedSigningAlgs is empty because signature verification at this boundary is structural; cryptographic verification is type-defined and deferred (see docs/v2-prep/rfc-mcp-mandate-extension.md §7 and the pact verify-proof precedent).',
        },
      },
    },
  };
}

export interface Gate {
  /** When set, return this immediately instead of running the tool handler. */
  block?: ToolResult;
  /**
   * Attach the verification verdict to the handler's result (RFC §6).
   * Success-conditional effects (binding-decision commit, escalation-approval
   * consumption) fire only when the result is not isError — a failed call
   * neither spends mandate authority nor burns a human approval.
   */
  stamp: (result: ToolResult) => ToolResult;
}

const passThroughGate: Gate = { stamp: (r) => r };

/** Run the mandate gate for one tool call. Never throws. */
export function mandateGuard(
  toolName: string,
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
): Gate {
  return mandateGuardAt(toolName, args, meta, Date.now());
}

/**
 * Clock-injectable variant — the seam the conformance runner uses so vectors
 * with fixed timestamps evaluate deterministically (verifier_clock pattern).
 */
export function mandateGuardAt(
  toolName: string,
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  now: number,
): Gate {
  try {
    return runGuard(toolName, args, meta, now);
  } catch (err) {
    // Belt-and-braces for the documented never-throws contract. No internal
    // detail (paths, stack) reaches the client.
    console.error(`[${MANDATE_EXTENSION_ID}] guard failure:`, err instanceof Error ? err.message : err);
    const cfg = cachedConfig;
    if (cfg?.enforcement === 'observed') return passThroughGate;
    return {
      block: mandateErrorResult(violation('MandateInvalidSignature', 'mandate guard internal failure — failing closed.')),
      stamp: (r) => r,
    };
  }
}

function runGuard(
  toolName: string,
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  now: number,
): Gate {
  const cfg = loadConfig();
  if (!cfg.enforcement) return passThroughGate;
  const metaValue = meta?.[MANDATE_EXTENSION_ID];
  const escMetaRaw = meta?.[ESCALATION_META_ID];
  const escMeta = typeof escMetaRaw === 'object' && escMetaRaw !== null ? (escMetaRaw as Record<string, unknown>) : undefined;
  const observed = cfg.enforcement === 'observed';

  if (metaValue === undefined) {
    if (cfg.enforcement === 'required') {
      // RFC §5: fail closed — including for clients that never declared the extension.
      return {
        block: mandateErrorResult(
          violation(
            'MandateRequired',
            `this server enforces ${MANDATE_EXTENSION_ID}; every tools/call must carry a mandate in _meta["${MANDATE_EXTENSION_ID}"].`,
          ),
        ),
        stamp: (r) => r,
      };
    }
    return passThroughGate; // optional/observed: absent is permitted.
  }

  const verified = verifyMandate(metaValue, cfg, now);
  const sessionId =
    verified.mandate && isNonEmptyString(verified.mandate.session_id) ? verified.mandate.session_id : undefined;

  if (verified.failure || !verified.mandate || !verified.digest) {
    const failure = verified.failure ?? violation('MandateRequired', 'mandate could not be processed.');
    if (observed) {
      // Observed: record, never reject — and record WHAT failed.
      return {
        stamp: (result) =>
          stampResult(result, {
            session_id: sessionId,
            verified: false,
            verification: 'structural',
            enforcement: 'observed',
            violations: [failure],
            notes: verified.notes,
          }),
      };
    }
    return { block: mandateErrorResult(failure, sessionId), stamp: (r) => r };
  }
  const mandate = verified.mandate;
  const mandateDigest = verified.digest;

  // Escalation retry path — validate a presented approval (consumed on success).
  const retry = validateEscalationRetry(toolName, args, mandate, mandateDigest, escMeta, cfg, now);
  const violations: Violation[] = [];
  if (retry.failure) {
    if (!observed) return { block: mandateErrorResult(retry.failure, sessionId), stamp: (r) => r };
    violations.push(retry.failure);
  }

  // Envelope — approved retries skip only the commitment gate (the approval
  // covers it); category and disclosure still apply.
  const envelope = evaluateEnvelope(toolName, args, mandate, mandateDigest, cfg, now, {
    skipCommitment: Boolean(retry.approvedState),
    observed,
  });
  if (!observed) {
    if (envelope.failure) return { block: mandateErrorResult(envelope.failure, sessionId), stamp: (r) => r };
    if (envelope.escalation) return { block: envelope.escalation, stamp: (r) => r };
  } else if (envelope.failure) {
    violations.push(envelope.failure);
  }

  const notes = [...verified.notes, ...retry.notes, ...envelope.notes];
  const verdict: Record<string, unknown> = {
    session_id: sessionId,
    verified: true,
    verification: 'structural',
    verified_at: new Date(now).toISOString(),
    enforcement: cfg.enforcement,
    notes,
  };
  if (violations.length > 0) {
    verdict['violations'] = violations;
    verdict['would_have_blocked'] = true;
  }
  if (envelope.suppressedEscalation) {
    verdict['escalation_suppressed'] = envelope.suppressedEscalation;
    verdict['would_have_blocked'] = true;
  }

  const approvedState = retry.approvedState;
  const commitBinding = envelope.bindingDecision || Boolean(approvedState);
  const expiresAtMs = Date.parse(String(mandate.expires_at));
  return {
    stamp: (result) => {
      if (!result.isError && !observed) {
        if (approvedState) pendingEscalations.delete(approvedState);
        if (commitBinding) {
          const entry = bindingDecisionsUsed.get(mandateDigest) ?? { count: 0, expiresAtMs };
          entry.count += 1;
          bindingDecisionsUsed.set(mandateDigest, entry);
        }
      }
      return stampResult(result, verdict);
    },
  };
}

function stampResult(result: ToolResult, verdict: Record<string, unknown>): ToolResult {
  return {
    ...result,
    _meta: { ...(result._meta ?? {}), [MANDATE_EXTENSION_ID]: verdict },
  };
}
