// Tests for the au.tailor.pact/mandate guard (src/mandate.ts).
// Runs against the compiled dist/ (npm test builds first). Each case mirrors
// a conformance vector in docs/v2-prep/mandate-mcp-vectors/ — keep the two
// in sync when semantics change.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANDATE_EXTENSION_ID,
  MANDATE_ERRORS,
  mandateGuard,
  mandateServerOptions,
  resetMandateStateForTests,
} from '../dist/mandate.js';

const EXT = MANDATE_EXTENSION_ID;
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

function meta(mandate) {
  return { [EXT]: mandate };
}

function errorOf(gate) {
  assert.ok(gate.block, 'expected a blocking result');
  assert.equal(gate.block.isError, true, 'expected isError');
  return gate.block._meta[EXT].error;
}

function setEnforcement(mode) {
  process.env.PACT_MANDATE_ENFORCEMENT = mode;
  resetMandateStateForTests();
}

beforeEach(() => {
  delete process.env.PACT_MANDATE_ENFORCEMENT;
  delete process.env.PACT_MANDATE_REGISTRY;
  delete process.env.PACT_MANDATE_CLOCK_SKEW_SECONDS;
  delete process.env.PACT_MANDATE_BINDING_TOOLS;
  resetMandateStateForTests();
});

test('disabled: guard is a pass-through and declares no capabilities', () => {
  const gate = mandateGuard('pact_intent', { documentId: 'd', category: 'other' }, undefined);
  assert.equal(gate.block, undefined);
  const result = { content: [{ type: 'text', text: '{}' }] };
  assert.equal(gate.stamp(result), result);
  assert.equal(mandateServerOptions(), undefined);
});

test('required: capability declared with SOQ2 default skew (300s, not the draft 30s)', () => {
  setEnforcement('required');
  const opts = mandateServerOptions();
  const decl = opts.capabilities.extensions[EXT];
  assert.equal(decl.enforcement, 'required');
  assert.equal(decl.maxClockSkewMs, 300_000);
  assert.equal(decl.digestMode, true);
});

test('vector mandate-absent-required: fail closed with MandateRequired (-32010)', () => {
  setEnforcement('required');
  const gate = mandateGuard('pact_agents', { documentId: 'd' }, undefined);
  const err = errorOf(gate);
  assert.equal(err.name, 'MandateRequired');
  assert.equal(err.code, MANDATE_ERRORS.MandateRequired);
});

test('vector mandate-valid-passthrough: in-envelope call permitted and verdict stamped', () => {
  setEnforcement('required');
  const gate = mandateGuard('pact_intent', { documentId: 'd', category: 'interface' }, meta(validMandate()));
  assert.equal(gate.block, undefined);
  const stamped = gate.stamp({ content: [{ type: 'text', text: '{}' }] });
  const verdict = stamped._meta[EXT];
  assert.equal(verdict.verified, true);
  assert.equal(verdict.session_id, 'sess_test');
  assert.ok(verdict.notes.some((n) => n.includes('not performed')), 'crypto deferral must be stated');
});

test('vector mandate-expired-rejected: MandateExpired (-32012) on stale expires_at', () => {
  setEnforcement('required');
  const mandate = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  const err = errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate)));
  assert.equal(err.code, MANDATE_ERRORS.MandateExpired);
});

test('vector mandate-forged-signature: missing required field is unverifiable (-32011)', () => {
  setEnforcement('required');
  const mandate = validMandate();
  delete mandate.signature;
  const err = errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate)));
  assert.equal(err.code, MANDATE_ERRORS.MandateInvalidSignature);
});

test('vector mandate-revoked-key: registry tombstone/revocation rejects (-32013)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pact-mandate-'));
  const registryPath = join(dir, 'registry.json');
  writeFileSync(
    registryPath,
    JSON.stringify({
      principals: [
        {
          id: 'did:web:knox.example',
          credentials: [{ id: 'key-1', revoked: true }],
        },
      ],
    }),
  );
  process.env.PACT_MANDATE_REGISTRY = registryPath;
  setEnforcement('required');
  const err = errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate())));
  assert.equal(err.code, MANDATE_ERRORS.MandateRevoked);
});

test('vector mandate-revoked-midsession: request N passes, revocation, request N+1 rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pact-mandate-'));
  const registryPath = join(dir, 'registry.json');
  const registry = {
    principals: [{ id: 'did:web:knox.example', credentials: [{ id: 'key-1', revoked: false }] }],
  };
  writeFileSync(registryPath, JSON.stringify(registry));
  process.env.PACT_MANDATE_REGISTRY = registryPath;
  setEnforcement('required');
  assert.equal(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate())).block, undefined);
  // Revoke on disk — NO guard reset. Per-request registry reads mean the
  // very next call fails; a cached verdict or cached registry would pass it.
  registry.principals[0].credentials[0].revoked = true;
  writeFileSync(registryPath, JSON.stringify(registry));
  const err = errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate())));
  assert.equal(err.code, MANDATE_ERRORS.MandateRevoked);
});

test('vector mandate-category-denied: out-of-envelope publish rejected (-32014)', () => {
  setEnforcement('required');
  const err = errorOf(
    mandateGuard('pact_constrain', { documentId: 'd', category: 'pricing' }, meta(validMandate())),
  );
  assert.equal(err.code, MANDATE_ERRORS.MandateCategoryDenied);
});

test('publishing call without category is permitted with an honesty note, not blocked', () => {
  setEnforcement('required');
  const gate = mandateGuard('pact_intent', { documentId: 'd', goal: 'x' }, meta(validMandate()));
  assert.equal(gate.block, undefined);
  const verdict = gate.stamp({ content: [] })._meta[EXT];
  assert.ok(verdict.notes.some((n) => n.includes('not determinable')));
});

test('vector mandate-disclosure-redacted: explicit disclosure_level above ceiling rejected (-32015)', () => {
  setEnforcement('required');
  const err = errorOf(
    mandateGuard('pact_escalate', { documentId: 'd', disclosure_level: 3 }, meta(validMandate())),
  );
  assert.equal(err.code, MANDATE_ERRORS.MandateDisclosureExceeded);
});

test('vector mandate-clock-skew: asserted_at too far in the future rejected (-32017)', () => {
  setEnforcement('required');
  const mandate = validMandate({ asserted_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  const err = errorOf(mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate)));
  assert.equal(err.code, MANDATE_ERRORS.MandateClockSkew);
});

test('vector mandate-digest-unknown: digest miss -32016, then full body populates the cache', () => {
  setEnforcement('required');
  const err = errorOf(
    mandateGuard('pact_agents', { documentId: 'd' }, meta({ session_id: 'sess_test', digest: 'deadbeef' })),
  );
  assert.equal(err.code, MANDATE_ERRORS.MandateDigestUnknown);
  // Full send caches the body; the digest-form retry needs the real digest,
  // which the client computes the same way — here we just re-send full.
  const gate = mandateGuard('pact_agents', { documentId: 'd' }, meta(validMandate()));
  assert.equal(gate.block, undefined);
});

test('vectors mandate-commitment-escalation + escalation-retry: suspend, approve once, single-use', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0, binding_scope: 's' } });
  const args = { documentId: 'd' };
  // 1. Binding call exceeds authority → input_required suspension, NOT an error.
  const gate1 = mandateGuard('pact_done', args, meta(mandate));
  assert.ok(gate1.block);
  assert.notEqual(gate1.block.isError, true, 'escalation must not be an error');
  const payload = JSON.parse(gate1.block.content[0].text);
  assert.equal(payload.resultType, 'input_required');
  assert.equal(payload.inputRequests[0].reason, 'commitment_authority_exceeded');
  const requestState = payload.requestState;
  assert.ok(requestState.startsWith('esc_'));
  // 2. Retry with a fresh §17.6 proof from the mandate's handler → approved.
  const proof = {
    type: 'fido2-assertion',
    principal_id: 'did:web:knox.example',
    credential_id: 'cred_abc',
    challenge_nonce: 'nonce',
    asserted_at: new Date().toISOString(),
    signature: 'base64url-sig',
  };
  const gate2 = mandateGuard('pact_done', args, {
    [EXT]: { ...mandate, request_state: requestState, authorization_proof: proof },
  });
  assert.equal(gate2.block, undefined, 'approved retry must proceed');
  gate2.stamp({ content: [] }); // commits the decision counter
  // 3. Same request_state again → consumed (single-use mandate invariant).
  const gate3 = mandateGuard('pact_done', args, {
    [EXT]: { ...mandate, request_state: requestState, authorization_proof: proof },
  });
  assert.ok(gate3.block?.isError, 'replayed approval must be rejected');
});

test('escalation retry with mismatched principal is rejected', () => {
  setEnforcement('required');
  const mandate = validMandate({ commitment_authority: { max_binding_decisions: 0 } });
  const args = { documentId: 'd' };
  const gate1 = mandateGuard('pact_done', args, meta(mandate));
  const requestState = JSON.parse(gate1.block.content[0].text).requestState;
  const gate2 = mandateGuard('pact_done', args, {
    [EXT]: {
      ...mandate,
      request_state: requestState,
      authorization_proof: {
        type: 'fido2-assertion',
        principal_id: 'did:web:mallory.example',
        credential_id: 'cred_x',
        challenge_nonce: 'n',
        asserted_at: new Date().toISOString(),
        signature: 's',
      },
    },
  });
  const err = errorOf(gate2);
  assert.equal(err.code, MANDATE_ERRORS.MandateInvalidSignature);
});

test('observed: invalid mandate is recorded, never blocked', () => {
  setEnforcement('observed');
  const mandate = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  const gate = mandateGuard('pact_agents', { documentId: 'd' }, meta(mandate));
  assert.equal(gate.block, undefined, 'observed mode must not block');
  const verdict = gate.stamp({ content: [] })._meta[EXT];
  assert.equal(verdict.verified, false);
  assert.equal(verdict.enforcement, 'observed');
});

test('optional: absent mandate permitted, present mandate enforced', () => {
  setEnforcement('optional');
  assert.equal(mandateGuard('pact_agents', { documentId: 'd' }, undefined).block, undefined);
  const bad = validMandate({ expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.ok(mandateGuard('pact_agents', { documentId: 'd' }, meta(bad)).block);
});
