// Tests for the au.tailor.pact/mandate guard (src/mandate.ts).
// Runs against the compiled dist/ (npm test builds first). Cases mirror the
// conformance vectors in docs/v2-prep/mandate-mcp-vectors/ — keep in sync.
// Wire-level behaviour (SDK argument stripping, _meta transport) is covered
// separately in test/wire.test.mjs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANDATE_EXTENSION_ID,
  ESCALATION_META_ID,
  MANDATE_ERRORS,
  mandateGuard,
  mandateServerOptions,
  resetMandateStateForTests,
} from '../dist/mandate.js';

const EXT = MANDATE_EXTENSION_ID;
const ESC = ESCALATION_META_ID;
const HOUR = 60 * 60 * 1000;

function validMandate(overrides = {}) {
  return {
    version: '1',
    session_id: 'sess_test',
    agent_id: 'agent_test',
    handler_principal_id: 'did:web:knox.example',
    identity_claim: 'test agent',
    constraint_envelope: {
      may_publish: ['interface', 'performance'],
      must_respect: [{ boundary: 'no breaking changes to event v1 schema' }],
    },
    commitment_authority: { max_binding_decisions: 1, binding_scope: 'test scope' },
    disclosure_ceiling: 2,
    expires_at: new Date(Date.now() + HOUR).toISOString(),
    signature: 'base64url-test-signature',
    signing_key_id: 'did:web:knox.example#key-1',
    ...overrides,
  };
}

function meta(mandate, escalation) {
  const m = { [EXT]: mandate };
  if (escalation) m[ESC] = escalation;
  return m;
}

function freshProof(nonce, overrides = {}) {
  return {
    type: 'fido2-assertion',
    principal_id: 'did:web:knox.example',
    credential_id: 'cred_abc',
    challenge_nonce: nonce,
    asserted_at: new Date().toISOString(),
    signature: 'base64url-proof-signature',
    ...overrides,
  };
}

function errorOf(gate) {
  assert.ok(gate.block, 'expected a blocking result');
  assert.equal(gate.block.isError, true, 'expected isError');
  return gate.block._meta[EXT].error;
}

function escalationOf(gate) {
  assert.ok(gate.block, 'expected a blocking result');
  assert.notEqual(gate.block.isError, true, 'escalation must not be an error');
  const payload = JSON.parse(gate.block.content[0].text);
  assert.equal(payload.resultType, 'input_required');
  return payload;
}

function setEnforcement(mode) {
  process.env.PACT_MANDATE_ENFORCEMENT = mode;
  resetMandateStateForTests();
}

function tempRegistry(registry) {
  const dir = mkdtempSync(join(tmpdir(), 'pact-mandate-'));
  const path = join(dir, 'registry.json');
  writeFileSync(path, JSON.stringify(registry));
  return path;
}

beforeEach(() => {
  delete process.env.PACT_MANDATE_ENFORCEMENT;
  delete process.env.PACT_MANDATE_REGISTRY;
  delete process.env.PACT_MANDATE_CLOCK_SKEW_SECONDS;
  delete process.env.PACT_MANDATE_BINDING_TOOLS;
  resetMandateStateForTests();
});

// ── Modes and capability ─────────────────────────────────────────

test('disabled: guard is a pass-through and declares no capabilities', () => {
  const gate = mandateGuard('pact_intent', { documentId: 'd', category: 'other' }, undefined);
  assert.equal(gate.block, undefined);
  const result = { content: [{ type: 'text', text: '{}' }] };
  assert.equal(gate.stamp(result), result);
  assert.equal(mandateServerOptions(), undefined);
});

test('required: capability declared with SOQ2 default skew and 2.1-draft specVersion', () => {
  setEnforcement('required');
  const decl = mandateServerOptions().capabilities.extensions[EXT];
  assert.equal(decl.enforcement, 'required');
  assert.equal(decl.maxClockSkewMs, 300_000);
  assert.equal(decl.digestMode, true);
  assert.equal(decl.specVersion, '2.1-draft');
});

test('vector mandate-absent-required: fail closed with MandateRequired (-32010)', () => {
  setEnforcement('required');
  const err = errorOf(mandateGuard('pact_agents', { documentId: 'd' }, undefined));
  assert.equal(err.code, MANDATE_ERRORS.MandateRequired);
});

test('optional: absent mandate permitted, present mandate enforced', () => {
  setEnforcement('optional');
  assert.equal(mandateGuard('pact_agents', { documentId: 'd' }, undefined).block, undefined);
  const bad = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.ok(mandateGuard('pact_agents', { documentId: 'd' }, meta(bad)).block);
});

// ── Structural verification ──────────────────────────────────────

test('vector mandate-valid-passthrough: permitted, verdict stamped as structural', () => {
  setEnforcement('required');
  const gate = mandateGuard('pact_intent', { documentId: 'd', category: 'interface' }, meta(validMandate()));
  assert.equal(gate.block, undefined);
  const verdict = gate.stamp({ content: [{ type: 'text', text: '{}' }] })._meta[EXT];
  assert.equal(verdict.verified, true);
  assert.equal(verdict.verification, 'structural');
  assert.equal(verdict.session_id, 'sess_test');
  assert.ok(verdict.notes.some((n) => n.includes('not performed')), 'crypto deferral must be stated');
});

test('vector mandate-expired-rejected: MandateExpired (-32012) on stale expires_at', () => {
  setEnforcement('required');
  const mandate = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate))).code, MANDATE_ERRORS.MandateExpired);
});

test('vector mandate-forged-signature: missing required field is unverifiable (-32011)', () => {
  setEnforcement('required');
  const mandate = validMandate();
  delete mandate.signature;
  assert.equal(errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate))).code, MANDATE_ERRORS.MandateInvalidSignature);
});

// ── Registry semantics ───────────────────────────────────────────

test('vector mandate-revoked-key: revoked credential rejected (-32013)', () => {
  process.env.PACT_MANDATE_REGISTRY = tempRegistry({
    principals: [{ id: 'did:web:knox.example', credentials: [{ id: 'key-1', revoked: true }] }],
  });
  setEnforcement('required');
  assert.equal(errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate()))).code, MANDATE_ERRORS.MandateRevoked);
});

test('unenrolled signing key fails closed (-32011) — revocation is not bypassable by renaming the key', () => {
  process.env.PACT_MANDATE_REGISTRY = tempRegistry({
    principals: [{ id: 'did:web:knox.example', credentials: [{ id: 'key-1', revoked: true }] }],
  });
  setEnforcement('required');
  const mandate = validMandate({ signing_key_id: 'did:web:knox.example#key-2' });
  assert.equal(errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate))).code, MANDATE_ERRORS.MandateInvalidSignature);
});

test('vector mandate-revoked-midsession: pass, revoke on disk, next request rejected — no reset', () => {
  const registry = {
    principals: [{ id: 'did:web:knox.example', credentials: [{ id: 'key-1', revoked: false }] }],
  };
  const path = tempRegistry(registry);
  process.env.PACT_MANDATE_REGISTRY = path;
  setEnforcement('required');
  assert.equal(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate())).block, undefined);
  registry.principals[0].credentials[0].revoked = true;
  writeFileSync(path, JSON.stringify(registry));
  assert.equal(errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate()))).code, MANDATE_ERRORS.MandateRevoked);
});

test('unreadable registry fails closed in required mode, with no filesystem path in the message', () => {
  process.env.PACT_MANDATE_REGISTRY = join(tmpdir(), 'pact-mandate-definitely-missing', 'registry.json');
  setEnforcement('required');
  const gate = mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate()));
  const err = errorOf(gate);
  assert.equal(err.code, MANDATE_ERRORS.MandateInvalidSignature);
  assert.ok(!gate.block.content[0].text.includes(tmpdir()), 'no path leakage');
});

test('unreadable registry in observed mode: recorded, never blocked', () => {
  process.env.PACT_MANDATE_REGISTRY = join(tmpdir(), 'pact-mandate-definitely-missing', 'registry.json');
  setEnforcement('observed');
  const gate = mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate()));
  assert.equal(gate.block, undefined, 'observed must not block on registry failure');
  const verdict = gate.stamp({ content: [] })._meta[EXT];
  assert.ok(verdict.notes.some((n) => n.includes('registry unavailable')));
});

// ── Envelope ─────────────────────────────────────────────────────

test('vector mandate-category-denied: out-of-envelope category rejected; absent category on a category tool also rejected', () => {
  setEnforcement('required');
  assert.equal(
    errorOf(mandateGuard('pact_constrain', { documentId: 'd', category: 'pricing' }, meta(validMandate()))).code,
    MANDATE_ERRORS.MandateCategoryDenied,
  );
  // Fail closed: under a scoped may_publish, categorised tools require a category.
  assert.equal(
    errorOf(mandateGuard('pact_intent', { documentId: 'd', goal: 'x' }, meta(validMandate()))).code,
    MANDATE_ERRORS.MandateCategoryDenied,
  );
  // No may_publish scoping → no category requirement.
  const unscoped = validMandate({ constraint_envelope: {} });
  assert.equal(mandateGuard('pact_intent', { documentId: 'd', goal: 'x' }, meta(unscoped)).block, undefined);
});

test('vector mandate-disclosure-redacted: disclosure_level above ceiling refused (-32015) on disclosure tools', () => {
  setEnforcement('required');
  assert.equal(
    errorOf(mandateGuard('pact_escalate', { documentId: 'd', message: 'm', disclosure_level: 3 }, meta(validMandate()))).code,
    MANDATE_ERRORS.MandateDisclosureExceeded,
  );
  assert.equal(
    mandateGuard('pact_escalate', { documentId: 'd', message: 'm', disclosure_level: 2 }, meta(validMandate())).block,
    undefined,
  );
});

// ── Digest mode ──────────────────────────────────────────────────

test('vector mandate-digest-unknown: digest miss -32016; full body caches only after verification', () => {
  setEnforcement('required');
  assert.equal(
    errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta({ session_id: 's', digest: 'deadbeef' }))).code,
    MANDATE_ERRORS.MandateDigestUnknown,
  );
  // A REJECTED body must not populate the cache.
  const bad = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  mandateGuard('pact_agents', { documentId: 'd' }, meta(bad));
  // A verified body does.
  assert.equal(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate())).block, undefined);
});

// ── Escalation lifecycle ─────────────────────────────────────────

test('vectors commitment-escalation + escalation-retry: suspend with nonce, approve once, consume on success only', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0, binding_scope: 's' } });
  const args = { documentId: 'd', status: 'aligned' };

  // 1. Suspension carries requestState + per-escalation challenge_nonce.
  const payload = escalationOf(mandateGuard('pact_done', args, meta(mandate)));
  assert.equal(payload.inputRequests[0].reason, 'commitment_authority_exceeded');
  assert.equal(payload.inputRequests[0].escalation_hook_notified, false);
  const requestState = payload.requestState;
  const nonce = payload.inputRequests[0].challenge_nonce;
  assert.ok(nonce, 'escalation must issue a challenge nonce');

  // 2. Retry with the handler's proof echoing the nonce → proceeds.
  const gate2 = mandateGuard('pact_done', args, meta(mandate, { request_state: requestState, authorization_proof: freshProof(nonce) }));
  assert.equal(gate2.block, undefined, 'approved retry must proceed');

  // 3. Handler FAILS → approval is NOT burned, counter NOT committed.
  gate2.stamp({ content: [{ type: 'text', text: 'upstream 500' }], isError: true });
  const gate3 = mandateGuard('pact_done', args, meta(mandate, { request_state: requestState, authorization_proof: freshProof(nonce) }));
  assert.equal(gate3.block, undefined, 'approval survives a transient failure');

  // 4. Handler SUCCEEDS → approval consumed, decision committed.
  gate3.stamp({ content: [{ type: 'text', text: 'ok' }] });

  // 5. Replay after success → unknown state (-32018).
  const gate4 = mandateGuard('pact_done', args, meta(mandate, { request_state: requestState, authorization_proof: freshProof(nonce) }));
  assert.equal(errorOf(gate4).code, MANDATE_ERRORS.MandateEscalationUnknown);
});

test('proof replay from an earlier escalation is rejected: wrong challenge_nonce (-32019)', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0 } });
  const args = { documentId: 'd', status: 'aligned' };
  const p1 = escalationOf(mandateGuard('pact_done', args, meta(mandate)));
  // Second escalation for different args mints a different nonce.
  const args2 = { documentId: 'd2', status: 'aligned' };
  const p2 = escalationOf(mandateGuard('pact_done', args2, meta(mandate)));
  // Byte-identical proof built for escalation 1, replayed against escalation 2.
  const gate = mandateGuard('pact_done', args2, meta(mandate, { request_state: p2.requestState, authorization_proof: freshProof(p1.inputRequests[0].challenge_nonce) }));
  assert.equal(errorOf(gate).code, MANDATE_ERRORS.MandateProofRejected);
});

test('escalation retry with mismatched principal rejected (-32019)', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0 } });
  const args = { documentId: 'd', status: 'aligned' };
  const payload = escalationOf(mandateGuard('pact_done', args, meta(mandate)));
  const gate = mandateGuard('pact_done', args, meta(mandate, {
    request_state: payload.requestState,
    authorization_proof: freshProof(payload.inputRequests[0].challenge_nonce, { principal_id: 'did:web:mallory.example' }),
  }));
  assert.equal(errorOf(gate).code, MANDATE_ERRORS.MandateProofRejected);
});

test('vector mandate-clock-skew: stale retry proof rejected (-32017)', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0 } });
  const args = { documentId: 'd', status: 'aligned' };
  const payload = escalationOf(mandateGuard('pact_done', args, meta(mandate)));
  const staleProof = freshProof(payload.inputRequests[0].challenge_nonce, {
    asserted_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const gate = mandateGuard('pact_done', args, meta(mandate, { request_state: payload.requestState, authorization_proof: staleProof }));
  assert.equal(errorOf(gate).code, MANDATE_ERRORS.MandateClockSkew);
});

test('escalation approval honours the registry: revoked approver credential rejected (-32019)', () => {
  process.env.PACT_MANDATE_REGISTRY = tempRegistry({
    principals: [{ id: 'did:web:knox.example', credentials: [{ id: 'key-1', revoked: false }, { id: 'cred_abc', revoked: true }] }],
  });
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0 } });
  const args = { documentId: 'd', status: 'aligned' };
  const payload = escalationOf(mandateGuard('pact_done', args, meta(mandate)));
  const gate = mandateGuard('pact_done', args, meta(mandate, {
    request_state: payload.requestState,
    authorization_proof: freshProof(payload.inputRequests[0].challenge_nonce),
  }));
  assert.equal(errorOf(gate).code, MANDATE_ERRORS.MandateProofRejected);
});

test('binding decisions are not consumed by failed calls', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 1 } });
  const args = { documentId: 'd', status: 'aligned' };
  // First call within authority; handler fails → counter must NOT commit.
  const gate1 = mandateGuard('pact_done', args, meta(mandate));
  assert.equal(gate1.block, undefined);
  gate1.stamp({ content: [], isError: true });
  // Still within authority.
  const gate2 = mandateGuard('pact_done', args, meta(mandate));
  assert.equal(gate2.block, undefined);
  gate2.stamp({ content: [] }); // success — consumes the one decision
  // Now exceeded → suspends.
  escalationOf(mandateGuard('pact_done', args, meta(mandate)));
});

// ── Observed mode provenance ─────────────────────────────────────

test('observed: invalid mandate recorded with the violation, never blocked', () => {
  setEnforcement('observed');
  const mandate = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  const gate = mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate));
  assert.equal(gate.block, undefined);
  const verdict = gate.stamp({ content: [] })._meta[EXT];
  assert.equal(verdict.verified, false);
  assert.equal(verdict.violations[0].name, 'MandateExpired');
});

test('observed: envelope violation and suppressed escalation appear in the audit record', () => {
  setEnforcement('observed');
  // Category violation recorded.
  const g1 = mandateGuard('pact_constrain', { documentId: 'd', category: 'pricing' }, meta(validMandate()));
  assert.equal(g1.block, undefined);
  const v1 = g1.stamp({ content: [] })._meta[EXT];
  assert.equal(v1.would_have_blocked, true);
  assert.equal(v1.violations[0].name, 'MandateCategoryDenied');
  // Over-authority binding call recorded as suppressed escalation; no pending state minted.
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0 } });
  const g2 = mandateGuard('pact_done', { documentId: 'd', status: 'aligned' }, meta(mandate));
  assert.equal(g2.block, undefined);
  const v2 = g2.stamp({ content: [] })._meta[EXT];
  assert.equal(v2.escalation_suppressed.reason, 'commitment_authority_exceeded');
  assert.equal(v2.would_have_blocked, true);
});
