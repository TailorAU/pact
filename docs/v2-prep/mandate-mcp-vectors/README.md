# Mandate-MCP conformance vectors (provisional)

Test vectors for the **`au.tailor.pact/mandate`** MCP extension — the twelve
cases specified in
[`docs/v2-prep/rfc-mcp-mandate-extension.md`](../rfc-mcp-mandate-extension.md) §12.

## Why they live here and not under `spec/`

Same incubation pattern as `docs/v2-prep/matters-vectors/` before the §24
promotion (`tools/promote-matters-to-v2.2.ps1`):

- `spec/v2.0/` is **frozen** (AGENTS.md rule 4), and the CI conformance runner
  executes `spec/v2.0/conformance/` only.
- The Mandate primitive's normative home is `spec/v2.1/` §19–20, which is
  [#35](https://github.com/TailorAU/pact/issues/35) and not yet authored.
- Promotion path: when #35 lands, these move to
  `spec/v2.1/conformance/extended/mandate-mcp/` (or the v2.2 re-issue per
  `spec/v2.2/README.md`), and the `kind: mandate` format below gets added to
  `test-vector-format.yaml` in that same reviewed change.

## Provisional format: `kind: mandate`

`test-vector-format.yaml` (schema version "1") defines `kind: http` and
`kind: verification`. Mandate vectors exercise a third surface — the MCP
`tools/call` boundary — so they use a provisional `kind: mandate`:

```yaml
kind: mandate           # provisional — not yet in test-vector-format.yaml
metadata:
  id: extended/mandate-mcp/<name>   # the id it will carry after promotion
  description: ...
  spec_section: "rfc-mcp-mandate-extension.md §N; RFC #14"
  conformance_level: extended
  track: T11
guard_config:           # server-side extension configuration under test
  enforcement: required # required | optional | observed
  clock_skew_seconds: 300
  registry: null        # or an inline principal-registry object
clock: "2026-08-01T00:00:00Z"   # injected server time (verifier_clock pattern)
steps:                  # sequential steps against ONE guard instance
  # A step is either a tool call…
  - call:
      tool: pact_intent
      arguments: { ... }          # MUST be schema-valid for the tool — the
                                  # SDK rejects invalid arguments before the
                                  # guard runs (protocol-level InvalidParams)
      meta:                       # request _meta
        au.tailor.pact/mandate: { ... }            # RFC #14 body VERBATIM,
                                                   # or { session_id, digest }
        au.tailor.pact/mandate-escalation:         # retry material only —
          request_state: "{captured.request_state}"  # never spliced into the
          authorization_proof: { ... }               # mandate body
    expected:
      outcome: pass | error | input_required
      error: { name: MandateExpired, code: -32012 }  # iff outcome: error
      verdict: { verified: true }                    # _meta stamp assertions
      input_required:                                # iff outcome: input_required
        reason: commitment_authority_exceeded
        requires: authorization_proof
        request_state_present: true
        challenge_nonce_present: true
      capture:                    # export values for later steps; reference
        request_state: requestState                  # them as "{captured.<key>}"
        challenge_nonce: inputRequests[0].challenge_nonce
  # …or an out-of-band state mutation between calls:
  - registry_update:              # replaces guard_config.registry content
      principals: [ ... ]
notes: |
  Drafting assumptions, in the onboard-success.yaml tradition.
failure_classification:
  severity: blocker
  common_causes: [ ... ]
```

## Runner status — honest ledger

**No runner executes these yet, and no CI workflow runs the mirror test
suite.** The vectors are executable in principle against `@pact-protocol/mcp`
≥ this change via the exported clock-injectable seam
`mandateGuardAt(tool, args, meta, nowMs)` (`mcp/src/mandate.ts`), and every
vector is mirrored by a passing test in `mcp/test/mandate.test.mjs` /
`mcp/test/wire.test.mjs` — locally runnable via `npm test` in `mcp/`, but not
wired into `validate.yml` (that edit needs a workflow-scoped push; tracked in
the PR that added this directory). Wiring `kind: mandate` into
`@pact-protocol/conformance-runner` is part of the promotion work, not this
drop. (Precedent: `expected_events` shipped in the format before the runner
executed it.)

## Semantics the vectors pin

- **Verbatim carriage.** `_meta["au.tailor.pact/mandate"]` holds the RFC #14
  body untouched (or the `{ session_id, digest }` pair); retry material rides
  under the sibling `au.tailor.pact/mandate-escalation` key.
- **Exceeding `commitment_authority` is not an error** — it suspends with an
  emulated `input_required` (MRTR) result carrying a per-escalation
  `challenge_nonce`. The retry's §17.6 `authorization_proof` must come from
  the mandate's handler and echo that nonce (§17.7 step 5 replay barrier —
  byte-identical proof replay across escalations fails). Approvals are
  consumed on the SUCCESS of the call they authorise — single-use, and a
  transient upstream failure does not burn a human approval.
- **Clock skew default is ±300 s** (SOQ2 ratified — §17.7's window; the RFC
  draft's 30 s was not adopted), applied to the retry proof's `asserted_at`.
  The mandate body has no client-time field; expiry is absolute.
- **Signature verification is structural** at this boundary — the same
  explicit deferral as `pact verify-proof` and the runner's non-crypto paths;
  every verdict carries `verification: structural` so the boolean cannot be
  read as cryptographic. `mandate-forged-signature` pins the *structural*
  failure mode; the cryptographic variant lands with type-defined crypto at
  promotion. Consequence, stated plainly: until mandate signature crypto is
  normative, a client able to fabricate mandate bodies can mint fresh
  authority — the registry checks narrow this, the crypto closes it.
- **Registry semantics fail closed**: an unenrolled signing key is rejected
  (otherwise revocation is bypassable by renaming the key), an unreadable
  registry rejects in enforcing modes, and the approver's credential on an
  escalation retry is checked against the registry too.
- **Revocation is immediate**: the registry is re-read per verification, so a
  revoked key fails the very next call (`mandate-revoked-midsession`) with no
  guard restart. The PACT-level Parley termination (`outcome=mandate_revoked`,
  ratified OQ1) is the fabric's obligation, out of scope at this boundary.
- **`enforcement: required` fails closed** — including for clients that never
  declared the extension (`mandate-absent-required`).
- **Observed mode records what it declines to block**: structural failures,
  envelope violations, and suppressed escalations all appear in the stamped
  verdict (`violations`, `would_have_blocked`, `escalation_suppressed`) — a
  denied call must never be indistinguishable from a clean pass in the audit
  trail.
- **Enforcement reach is declared, not assumed.** The MCP SDK strips
  arguments a tool's schema does not declare, so argument-based checks reach
  exactly: `category` → pact_intent, pact_constrain (required under a scoped
  `may_publish`); `disclosure_level` → pact_escalate, pact_ask. Binding-tool
  default set: pact_done, pact_lock, pact_matter_close,
  pact_matter_add_member, pact_matter_attach, pact_matter_detach. Counters
  are in-process and keyed by mandate digest — advisory against a client that
  owns the proxy process, in the same voice as the crypto deferral.

## The twelve vectors

| File | Pins |
|---|---|
| `mandate-valid-passthrough.yaml` | Well-formed mandate, in-envelope call, permitted + verdict stamped |
| `mandate-expired-rejected.yaml` | `-32012` on stale `expires_at` (server clock authoritative) |
| `mandate-forged-signature.yaml` | `-32011` structural: required field missing/malformed |
| `mandate-revoked-key.yaml` | `-32013` against a revoked signing key |
| `mandate-category-denied.yaml` | `-32014` outside `may_publish`, and on category-less publish under a scoped mandate |
| `mandate-commitment-escalation.yaml` | `input_required` suspension with challenge nonce, not an error |
| `mandate-escalation-retry.yaml` | Nonce-bound retry succeeds; consumed on success; replay `-32018` |
| `mandate-revoked-midsession.yaml` | Pass, revoke, next request rejected |
| `mandate-disclosure-redacted.yaml` | `-32015` where redaction is impossible at this boundary |
| `mandate-digest-unknown.yaml` | `-32016` then full-body retry succeeds |
| `mandate-clock-skew.yaml` | `-32017` on a retry proof's `asserted_at` beyond the ±300 s window |
| `mandate-absent-required.yaml` | `-32010` fail-closed under `enforcement: required` |
