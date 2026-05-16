/**
 * §15.4 cross-organisation boundary + §17.13 manifest visibility.
 *
 * Minimal implementation: two `did:web` principals are cross-org iff their
 * registrable-domain (eTLD+1) components differ. The reference server uses
 * the last-two-labels heuristic for the `.example` test domains the
 * conformance vectors use (org-a.example vs org-b.example → cross-org;
 * org.example vs api.org.example → intra-org). A production implementation
 * MUST use the Public Suffix List per §15.4 — this is intentionally minimal.
 */

import type { Member } from './store.js';

function registrableDomain(principalId: string): string {
  // did:web:org-a.example → org-a.example
  const m = /^did:web:([^/]+)/.exec(principalId);
  const host = m ? m[1] : principalId;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  return labels.slice(-2).join('.');
}

function didMethod(principalId: string): string {
  const m = /^did:([a-z0-9]+):/.exec(principalId);
  return m ? m[1] : '';
}

/** §15.4: cross-org iff different DID method, or different eTLD+1 for did:web. */
export function isCrossOrg(callerPrincipal: string, peerPrincipal: string): boolean {
  if (callerPrincipal === peerPrincipal) return false;
  if (didMethod(callerPrincipal) !== didMethod(peerPrincipal)) return true;
  if (didMethod(callerPrincipal) === 'web') {
    return registrableDomain(callerPrincipal) !== registrableDomain(peerPrincipal);
  }
  // non-web methods with same method but different identifier: treat as cross-org.
  return true;
}

/**
 * Reduce a peer member's record to the §17.13 cross-org view. PII (contact,
 * raw constraints, raw obligations) is elided; only a human-readable
 * `display_name` plus summary counts survive. Same-org peers keep full
 * visibility.
 */
export function reducePeerForManifest(
  caller: Member,
  peer: Member,
  pendingObligationCount: number,
): Record<string, unknown> {
  const crossOrg = isCrossOrg(caller.principal_id, peer.principal_id);
  if (!crossOrg) {
    return {
      agent_id: peer.agent_id,
      agent_name: peer.agent_name,
      principal_id: peer.principal_id,
      role: peer.role,
      trust_level: peer.trust_level,
      last_seen: peer.last_seen,
      disclosure_level: 'full',
      cross_org: false,
      contact_visible: true,
      contact: peer.contact,
      constraints: peer.constraints,
      constraints_summary: { count: peer.constraints.length },
      obligations_summary: { pending_count: pendingObligationCount },
      pending_obligation_count: pendingObligationCount,
    };
  }
  // Cross-org, no consent on file → §17.13 reduction. `agent_name` (display
  // name) is retained so the manifest stays human-usable; `principal_id`,
  // `contact`, raw constraints and raw obligations are elided (key omitted,
  // not nulled, per §17.13).
  return {
    principal_id: peer.principal_id,
    display_name: peer.agent_name,
    role: peer.role,
    trust_level: peer.trust_level,
    last_seen: peer.last_seen,
    disclosure_level: peer.disclosure_level,
    cross_org: true,
    contact_visible: false,
    constraints_summary: { count: peer.constraints.length },
    obligations_summary: { pending_count: pendingObligationCount },
    pending_obligation_count: pendingObligationCount,
  };
}
