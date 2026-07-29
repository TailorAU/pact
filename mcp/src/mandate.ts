/**
 * au.tailor.pact/mandate — MCP extension guard for @pact-protocol/mcp.
 *
 * Design record: docs/v2-prep/rfc-mcp-mandate-extension.md (merged via PR #40).
 * Mandate primitive: RFC #14 (ACCEPT-WITH-MODIFICATIONS, 2026-05-16 — the
 * Parley RFC; normative §19–20 text is #35 / spec/v2.1). The mandate body is
 * carried VERBATIM from RFC #14 — this module adds no fields.
 *
 * What this guard does, per request, when enforcement is configured:
 *   1. Reads the mandate from request _meta["au.tailor.pact/mandate"].
 *   2. Verifies it structurally (fields, DID shape, expiry against the server
 *      clock, registry tombstone/revocation when a registry is configured).
 *      Cryptographic signature verification is type-defined and deliberately
 *      NOT performed here — the same explicit deferral as `pact verify-proof`
 *      (cli/src/commands/verify-proof.ts) and the conformance runner (T9).
 *   3. Evaluates the call against the constraint envelope, commitment
 *      authority, and disclosure ceiling.
 *   4. Exceeding commitment_authority is NOT an error: the call suspends with
 *      an emulated Multi Round-Trip Request result (resultType
 *      "input_required") and resumes when the client retries carrying a §17.6
 *      authorization_proof. Approvals are SINGLE-USE.
 *   5. Stamps the result's _meta with a verification verdict for provenance.
 *
 * SDK note: @modelcontextprotocol/sdk ^1.12.0 predates the 2026-07-28 MCP
 * revision, so two surfaces are emulated and documented as such:
 *   - JSON-RPC extension error codes (-32010..-32017) are carried inside the
 *     house isError content + result._meta, not as protocol-level errors.
 *   - input_required is a structured tool result, not a first-class
 *     resultType. Both migrate mechanically when the SDK lands 2026-07-28.
 *
 * Ratified decisions honoured here (rfc-14-shepherd-synthesis.yaml):
 *   - SOQ2: clock skew reuses §17.7's ±5 minutes (300s) default, configurable.
 *     The RFC draft's 30s was NOT adopted.
 *   - OQ1: revocation is immediate. Under per-request verification there is
 *     no round to finish — the next request fails. (The PACT-level Parley
 *     termination with outcome=mandate_revoked is the fabric's job, not this
 *     MCP boundary's.)
 * Open-question implementation defaults (flagged, not settled):
 *   - Q2: binding_scope is treated as advisory outside the issuing fabric —
 *     a note is emitted, never a rejection on scope alone.
 *   - Q3: enforcement is server-authoritative; this guard is the server side
 *     of the MCP boundary. No client-side pre-check is assumed.
 *
 * Config (env):
 *   PACT_MANDATE_ENFORCEMENT   unset → guard disabled (backward compatible);
 *                              "required" | "optional" | "observed"
 *   PACT_MANDATE_CLOCK_SKEW_SECONDS  default 300 (§17.7 / SOQ2)
 *   PACT_MANDATE_REGISTRY      path to a principal-registry.json (same shape
 *                              `pact verify-proof --registry` accepts)
 *   PACT_MANDATE_BINDING_TOOLS csv override of which tools are binding
 *                              decisions (default: pact_done, pact_lock,
 *                              pact_matter_close)
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const MANDATE_EXTENSION_ID = 'au.tailor.pact/mandate';
export const ESCALATION_TYPE = 'au.tailor.pact/mandate-escalation';

export type Enforcement = 'required' | 'optional' | 'observed';

/** RFC §11 error table. Implementation-defined JSON-RPC range (-32000..-32019). */
export const MANDATE_ERRORS = {
  MandateRequired: -32010,
  MandateInvalidSignature: -32011,
  MandateExpired: -32012,
  MandateRevoked: -32013,
  MandateCategoryDenied: -32014,
  MandateDisclosureExceeded: -32015,
  MandateDigestUnknown: -32016,
  MandateClockSkew: -32017,
} as const;
export type MandateErrorName = keyof typeof MANDATE_ERRORS;

/** Tools that publish content into the fabric — category-checkable. */
const PUBLISHING_TOOLS = new Set([
  'pact_intent',
  'pact_constrain',
  'pact_salience',
  'pact_object',
  'pact_ask',
  'pact_escalate',
  'pact_negotiate_position',
  'pact_matter_message',
]);

/** Default binding-decision tools (overridable via PACT_MANDATE_BINDING_TOOLS). */
const DEFAULT_BINDING_TOOLS = ['pact_done', 'pact_lock', 'pact_matter_close'];

const ESCALATION_TTL_MS = 10 * 60 * 1000;

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
  asserted_at?: unknown;
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
 * take effect on the very next request (ratified RFC #14 OQ1; see the
 * mandate-revoked-midsession vector). Registry files are small; a per-call
 * read on a local stdio proxy is the correct trade.
 */
function loadRegistry(cfg: Config): Registry | null {
  if (!cfg.registryPath) return null;
  const parsed = JSON.parse(readFileSync(cfg.registryPath, 'utf8')) as Registry;
  if (!Array.isArray(parsed.principals)) {
    throw new Error(`PACT_MANDATE_REGISTRY file must contain a "principals" array.`);
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
// This is a stdio proxy: one process per client session. State here is a
// cache/counter, never a protocol-level session (the 2026-07-28 sense).

/** Digest mode (RFC §6): full mandate bodies cached by SHA-256 of the canonical body. */
const mandateByDigest = new Map<string, Mandate>();

interface PendingEscalation {
  sessionId: string;
  tool: string;
  argsDigest: string;
  detail: Record<string, unknown>;
  createdAt: number;
}
const pendingEscalations = new Map<string, PendingEscalation>();

/** Binding decisions consumed, per mandate session_id. */
const bindingDecisionsUsed = new Map<string, number>();

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

function sweepEscalations(now: number): void {
  for (const [key, entry] of pendingEscalations) {
    if (now - entry.createdAt > ESCALATION_TTL_MS) pendingEscalations.delete(key);
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

function mandateErrorResult(
  name: MandateErrorName,
  detail: string,
  sessionId?: string,
): ToolResult {
  const code = MANDATE_ERRORS[name];
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: [${MANDATE_EXTENSION_ID}] ${name} (${code}): ${detail}`,
      },
    ],
    isError: true,
    _meta: {
      [MANDATE_EXTENSION_ID]: {
        verified: false,
        error: { name, code },
        ...(sessionId ? { session_id: sessionId } : {}),
      },
    },
  };
}

// ── Verification (RFC §7 — structural; crypto deferred like verify-proof) ──

interface VerifyOutcome {
  mandate?: Mandate;
  error?: ToolResult;
  notes: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function verifyMandate(metaValue: unknown, cfg: Config, now: number): VerifyOutcome {
  const notes: string[] = [];
  if (typeof metaValue !== 'object' || metaValue === null) {
    return { notes, error: mandateErrorResult('MandateRequired', 'mandate _meta value is not an object.') };
  }
  let mandate = metaValue as Mandate;

  // Digest mode (RFC §6): { session_id, digest } after first full send.
  if (!('version' in mandate) && isNonEmptyString(mandate.digest)) {
    const cached = mandateByDigest.get(mandate.digest);
    if (!cached) {
      return {
        notes,
        error: mandateErrorResult(
          'MandateDigestUnknown',
          `no cached mandate for digest ${String(mandate.digest).slice(0, 16)}…; retry with the full mandate body.`,
          isNonEmptyString(mandate.session_id) ? mandate.session_id : undefined,
        ),
      };
    }
    notes.push('digest mode: mandate body resolved from cache');
    mandate = cached;
  } else {
    const digest = sha256Hex(canonicalJson(mandate));
    mandateByDigest.set(digest, mandate);
  }

  const sessionId = isNonEmptyString(mandate.session_id) ? mandate.session_id : undefined;

  // Required fields (RFC #14 mandate shape, carried verbatim).
  const required: Array<[string, unknown]> = [
    ['version', mandate.version],
    ['session_id', mandate.session_id],
    ['agent_id', mandate.agent_id],
    ['handler_principal_id', mandate.handler_principal_id],
    ['expires_at', mandate.expires_at],
    ['signature', mandate.signature],
    ['signing_key_id', mandate.signing_key_id],
  ];
  for (const [field, value] of required) {
    if (!isNonEmptyString(value) && typeof value !== 'number') {
      return {
        notes,
        error: mandateErrorResult(
          'MandateInvalidSignature',
          `mandate is missing required field "${field}" — cannot verify.`,
          sessionId,
        ),
      };
    }
  }

  if (!/^did:[a-z0-9]+:.+/.test(String(mandate.handler_principal_id))) {
    return {
      notes,
      error: mandateErrorResult(
        'MandateInvalidSignature',
        `handler_principal_id "${String(mandate.handler_principal_id)}" is not a DID.`,
        sessionId,
      ),
    };
  }

  // Expiry — server clock is authoritative (RFC #14 Q6, ratified).
  const expiresMs = Date.parse(String(mandate.expires_at));
  if (!Number.isFinite(expiresMs)) {
    return {
      notes,
      error: mandateErrorResult('MandateExpired', `expires_at "${String(mandate.expires_at)}" is not ISO 8601.`, sessionId),
    };
  }
  if (now > expiresMs) {
    return {
      notes,
      error: mandateErrorResult(
        'MandateExpired',
        `mandate expired at ${String(mandate.expires_at)} (server time ${new Date(now).toISOString()}).`,
        sessionId,
      ),
    };
  }

  // Clock skew (SOQ2: ±5 min default): a mandate asserted in the future
  // beyond the window indicates client clock drift.
  if (isNonEmptyString(mandate.asserted_at)) {
    const assertedMs = Date.parse(mandate.asserted_at);
    if (Number.isFinite(assertedMs) && assertedMs - now > cfg.clockSkewMs) {
      return {
        notes,
        error: mandateErrorResult(
          'MandateClockSkew',
          `asserted_at is ${Math.round((assertedMs - now) / 1000)}s in the future (allowed skew ${cfg.clockSkewMs / 1000}s).`,
          sessionId,
        ),
      };
    }
  }

  // Registry checks (conditional, like `pact verify-proof --registry`).
  // Re-read per verification — see loadRegistry.
  const registry = loadRegistry(cfg);
  if (registry) {
    const principalId = String(mandate.handler_principal_id);
    const principal = (registry.principals ?? []).find((p) => p.id === principalId);
    if (!principal) {
      return {
        notes,
        error: mandateErrorResult('MandateInvalidSignature', `principal ${principalId} not found in registry.`, sessionId),
      };
    }
    if (principal.tombstoned_at) {
      return {
        notes,
        error: mandateErrorResult('MandateRevoked', `principal ${principalId} is tombstoned (${principal.tombstoned_at}).`, sessionId),
      };
    }
    const signingKeyId = String(mandate.signing_key_id);
    const fragment = signingKeyId.includes('#') ? signingKeyId.slice(signingKeyId.indexOf('#') + 1) : signingKeyId;
    const credential = (principal.credentials ?? []).find(
      (c) => c.id === signingKeyId || c.id === fragment,
    );
    if (credential?.revoked) {
      return {
        notes,
        error: mandateErrorResult('MandateRevoked', `signing key ${signingKeyId} is revoked.`, sessionId),
      };
    }
    if (!credential) notes.push(`signing key ${signingKeyId} not enrolled in registry — signature unverifiable`);
    else notes.push('principal resolved; signing key enrolled and not revoked');
  } else {
    notes.push('no registry configured — principal/revocation checks skipped');
  }

  notes.push(
    'signature present; cryptographic verification is type-defined and not performed by this guard (same deferral as pact verify-proof / conformance runner T9)',
  );
  return { mandate, notes };
}

// ── Envelope evaluation (RFC §8) ─────────────────────────────────

interface EnvelopeOutcome {
  error?: ToolResult;
  escalation?: ToolResult;
  notes: string[];
  /** Called after the underlying handler succeeds, to commit counters. */
  onSuccess?: () => void;
}

function evaluateEnvelope(
  toolName: string,
  args: Record<string, unknown>,
  mandate: Mandate,
  cfg: Config,
  now: number,
): EnvelopeOutcome {
  const notes: string[] = [];
  const sessionId = String(mandate.session_id);

  // 1. Constraint envelope — category membership where determinable.
  const mayPublish = mandate.constraint_envelope?.may_publish;
  if (Array.isArray(mayPublish) && PUBLISHING_TOOLS.has(toolName)) {
    const category = args['category'];
    if (isNonEmptyString(category)) {
      if (!mayPublish.map(String).includes(category)) {
        return {
          notes,
          error: mandateErrorResult(
            'MandateCategoryDenied',
            `category "${category}" is not in the mandate's may_publish list [${mayPublish.map(String).join(', ')}].`,
            sessionId,
          ),
        };
      }
      notes.push(`category "${category}" permitted by may_publish`);
    } else {
      notes.push('publishing call without a category argument — category not determinable at the MCP boundary, not blocked');
    }
  }
  const mustRespect = mandate.constraint_envelope?.must_respect;
  if (Array.isArray(mustRespect) && mustRespect.length > 0) {
    // RFC §8: natural-language boundaries are carried, NOT machine-enforced.
    notes.push(
      `${mustRespect.length} must_respect boundar${mustRespect.length === 1 ? 'y' : 'ies'} carried, not machine-enforced`,
    );
  }

  // 2. Disclosure ceiling — only explicit disclosure_level args are checkable here.
  const ceiling = mandate.disclosure_ceiling;
  if (typeof ceiling === 'number') {
    const level = args['disclosure_level'];
    if (typeof level === 'number' && level > ceiling) {
      return {
        notes,
        error: mandateErrorResult(
          'MandateDisclosureExceeded',
          `disclosure_level ${level} exceeds the mandate's disclosure_ceiling ${ceiling} (§10.3 levels 1–4).`,
          sessionId,
        ),
      };
    }
  }

  // 3. Commitment authority — exceeding it escalates, never errors (RFC §8/§9).
  if (cfg.bindingTools.has(toolName)) {
    const authority = mandate.commitment_authority;
    const max = typeof authority?.max_binding_decisions === 'number' ? authority.max_binding_decisions : null;
    const used = bindingDecisionsUsed.get(sessionId) ?? 0;
    const scope = isNonEmptyString(authority?.binding_scope) ? authority?.binding_scope : undefined;
    if (scope) {
      // Q2 default: advisory outside the issuing fabric — noted, never rejected on scope alone.
      notes.push(`binding_scope "${scope}" is advisory at this MCP boundary (open question 2 default)`);
    }
    if (max !== null && used >= max) {
      sweepEscalations(now);
      const requestState = `esc_${randomUUID()}`;
      const detail = {
        requested: `binding decision via ${toolName}`,
        binding_scope: scope ?? null,
        max_binding_decisions: max,
        decisions_used: used,
      };
      pendingEscalations.set(requestState, {
        sessionId,
        tool: toolName,
        argsDigest: sha256Hex(canonicalJson(args)),
        detail,
        createdAt: now,
      });
      const payload = {
        resultType: 'input_required',
        inputRequests: [
          {
            type: ESCALATION_TYPE,
            reason: 'commitment_authority_exceeded',
            detail,
            requires: 'authorization_proof',
            escalation_hook_notified: false,
          },
        ],
        requestState,
        retry:
          `Re-invoke ${toolName} with identical arguments, adding to _meta["${MANDATE_EXTENSION_ID}"]: ` +
          `{ "request_state": "${requestState}", "authorization_proof": { …§17.6 envelope… } }. Approvals are single-use.`,
        note:
          'Emulated Multi Round-Trip Request: @modelcontextprotocol/sdk 1.x predates resultType "input_required" (MCP 2026-07-28); this structured result carries the same contract.',
      };
      // escalation_hook delivery is PACT push delivery (§21, T4) — not wired
      // at this boundary yet; the flag above says so truthfully.
      return {
        notes,
        escalation: {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          _meta: {
            [MANDATE_EXTENSION_ID]: {
              session_id: sessionId,
              escalation: { requestState, reason: 'commitment_authority_exceeded', ...detail },
            },
          },
        },
      };
    }
    return {
      notes,
      onSuccess: () => bindingDecisionsUsed.set(sessionId, used + 1),
    };
  }

  return { notes };
}

// ── Escalation retry (RFC §9) ────────────────────────────────────

function consumeEscalation(
  toolName: string,
  args: Record<string, unknown>,
  mandate: Mandate,
  extMeta: Record<string, unknown>,
  cfg: Config,
  now: number,
): { error?: ToolResult; approved?: boolean; notes: string[] } {
  const notes: string[] = [];
  const requestState = extMeta['request_state'];
  const proof = extMeta['authorization_proof'];
  if (!isNonEmptyString(requestState) || typeof proof !== 'object' || proof === null) {
    return { notes };
  }
  sweepEscalations(now);
  const sessionId = String(mandate.session_id);
  const pending = pendingEscalations.get(requestState);
  if (!pending) {
    return {
      notes,
      error: mandateErrorResult(
        'MandateRequired',
        `request_state "${requestState}" is unknown or expired (escalations are single-use and expire after ${ESCALATION_TTL_MS / 60000} minutes).`,
        sessionId,
      ),
    };
  }
  if (pending.sessionId !== sessionId || pending.tool !== toolName || pending.argsDigest !== sha256Hex(canonicalJson(args))) {
    return {
      notes,
      error: mandateErrorResult(
        'MandateRequired',
        'escalation retry must re-invoke the same tool with identical arguments under the same mandate session.',
        sessionId,
      ),
    };
  }
  // §17.6 structural verification of the proof (crypto deferred, as everywhere).
  const p = proof as Record<string, unknown>;
  for (const field of ['type', 'principal_id', 'credential_id', 'challenge_nonce', 'asserted_at', 'signature']) {
    if (!isNonEmptyString(p[field])) {
      return {
        notes,
        error: mandateErrorResult('MandateInvalidSignature', `authorization_proof is missing "${field}".`, sessionId),
      };
    }
  }
  const proofType = String(p['type']);
  if (
    proofType !== 'fido2-assertion' &&
    proofType !== 'voice-biometric' &&
    !/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(proofType)
  ) {
    return {
      notes,
      error: mandateErrorResult('MandateInvalidSignature', `authorization_proof type "${proofType}" is not recognised (§18).`, sessionId),
    };
  }
  if (String(p['principal_id']) !== String(mandate.handler_principal_id)) {
    return {
      notes,
      error: mandateErrorResult(
        'MandateInvalidSignature',
        `authorization_proof principal ${String(p['principal_id'])} does not match the mandate's handler ${String(mandate.handler_principal_id)}.`,
        sessionId,
      ),
    };
  }
  const assertedMs = Date.parse(String(p['asserted_at']));
  if (!Number.isFinite(assertedMs) || Math.abs(now - assertedMs) > cfg.clockSkewMs) {
    return {
      notes,
      error: mandateErrorResult(
        'MandateExpired',
        `authorization_proof asserted_at is outside the ±${cfg.clockSkewMs / 1000}s freshness window (§17.7 step 4).`,
        sessionId,
      ),
    };
  }
  // Single-use: consume before approving (the mandate invariant).
  pendingEscalations.delete(requestState);
  bindingDecisionsUsed.set(sessionId, (bindingDecisionsUsed.get(sessionId) ?? 0) + 1);
  notes.push(
    `escalation ${requestState} approved by ${String(p['principal_id'])} via ${proofType} proof (structural verification; crypto type-defined) and consumed`,
  );
  return { approved: true, notes };
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
          specVersion: '2.0.3',
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
  /** Attach the verification verdict to a successful handler result (RFC §6). */
  stamp: (result: ToolResult) => ToolResult;
}

const passThroughGate: Gate = { stamp: (r) => r };

/**
 * Run the mandate gate for one tool call. Never throws; failures use the
 * house isError contract with the RFC §11 code carried in text + _meta.
 */
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
  const cfg = loadConfig();
  if (!cfg.enforcement) return passThroughGate;
  const metaValue = meta?.[MANDATE_EXTENSION_ID];

  if (metaValue === undefined) {
    if (cfg.enforcement === 'required') {
      // RFC §5: fail closed — including for clients that never declared the extension.
      return {
        block: mandateErrorResult(
          'MandateRequired',
          `this server enforces ${MANDATE_EXTENSION_ID}; every tools/call must carry a mandate in _meta["${MANDATE_EXTENSION_ID}"].`,
        ),
        stamp: (r) => r,
      };
    }
    return passThroughGate; // optional/observed: absent is permitted.
  }

  const verified = verifyMandate(metaValue, cfg, now);
  const observed = cfg.enforcement === 'observed';

  if (verified.error || !verified.mandate) {
    if (observed && verified.error) {
      // Observed: record, never reject. The verdict says verified:false.
      const errMeta = (verified.error._meta?.[MANDATE_EXTENSION_ID] ?? {}) as Record<string, unknown>;
      return {
        stamp: (result) => stampResult(result, { ...errMeta, enforcement: 'observed', notes: verified.notes }),
      };
    }
    return { block: verified.error, stamp: (r) => r };
  }
  const mandate = verified.mandate;
  const sessionId = String(mandate.session_id);
  const extMeta = (typeof metaValue === 'object' ? metaValue : {}) as Record<string, unknown>;

  // Escalation retry path — consume a pending approval if presented.
  const retry = consumeEscalation(toolName, args, mandate, extMeta, cfg, now);
  if (retry.error && !observed) return { block: retry.error, stamp: (r) => r };

  let envelope: EnvelopeOutcome;
  if (retry.approved) {
    envelope = { notes: retry.notes };
  } else {
    envelope = evaluateEnvelope(toolName, args, mandate, cfg, now);
    if (!observed) {
      if (envelope.error) return { block: envelope.error, stamp: (r) => r };
      if (envelope.escalation) return { block: envelope.escalation, stamp: (r) => r };
    }
  }

  const notes = [...verified.notes, ...retry.notes, ...envelope.notes];
  const verdict: Record<string, unknown> = {
    session_id: sessionId,
    verified: true,
    verified_at: new Date(now).toISOString(),
    enforcement: cfg.enforcement,
    notes,
  };
  return {
    stamp: (result) => {
      envelope.onSuccess?.();
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
