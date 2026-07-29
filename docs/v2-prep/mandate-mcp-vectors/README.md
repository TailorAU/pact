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
steps:                  # sequential MCP tool calls against one guard instance
  - call:
      tool: pact_intent
      arguments: { ... }
      meta:             # request _meta
        au.tailor.pact/mandate: { ... }
    expected:
      outcome: pass | error | input_required
      error: { name: MandateExpired, code: -32012 }   # iff outcome: error
      verdict: { verified: true }                     # _meta stamp assertions
notes: |
  Drafting assumptions, in the onboard-success.yaml tradition.
failure_classification:
  severity: blocker
  common_causes: [ ... ]
```

## Runner status — honest ledger

**No runner executes these yet.** They are executable in principle against
`@pact-protocol/mcp` ≥ this change via the exported clock-injectable seam
`mandateGuardAt(tool, args, meta, nowMs)` (`mcp/src/mandate.ts`), and every
vector here is mirrored by a passing test in `mcp/test/mandate.test.mjs` —
that suite is the current enforcement of these semantics. Wiring `kind:
mandate` into `@pact-protocol/conformance-runner` is part of the promotion
work, not this drop. (Precedent: `expected_events` shipped in the format
before the runner executed it.)

## Semantics the vectors pin

- **Exceeding `commitment_authority` is not an error** — it suspends with an
  emulated `input_required` (MRTR) result and resumes on retry with a §17.6
  `authorization_proof` from the mandate's handler. Approvals are single-use.
- **Clock skew default is ±300 s** (SOQ2 ratified — §17.7's window; the RFC
  draft's 30 s was not adopted).
- **Signature verification is structural** at this boundary — the same
  explicit deferral as `pact verify-proof` and the runner's non-crypto paths.
  `mandate-forged-signature` therefore pins the *structural* failure mode; the
  cryptographic variant lands with type-defined crypto at promotion.
- **Revocation is immediate**: per-request verification means a revoked key
  fails the very next call (`mandate-revoked-midsession`). The PACT-level
  Parley termination (`outcome=mandate_revoked`, ratified OQ1) is the
  fabric's obligation, out of scope at this boundary.
- **`enforcement: required` fails closed** — including for clients that never
  declared the extension (`mandate-absent-required`).

## The twelve vectors

| File | Pins |
|---|---|
| `mandate-valid-passthrough.yaml` | Well-formed mandate, in-envelope call, permitted + verdict stamped |
| `mandate-expired-rejected.yaml` | `-32012` on stale `expires_at` (server clock authoritative) |
| `mandate-forged-signature.yaml` | `-32011` structural: required field missing/malformed |
| `mandate-revoked-key.yaml` | `-32013` against a revoked signing key |
| `mandate-category-denied.yaml` | `-32014` on publish outside `may_publish` |
| `mandate-commitment-escalation.yaml` | `input_required` suspension, not an error |
| `mandate-escalation-retry.yaml` | Retry with proof succeeds once; replay rejected |
| `mandate-revoked-midsession.yaml` | Pass, revoke, next request rejected |
| `mandate-disclosure-redacted.yaml` | `-32015` where redaction is impossible at this boundary |
| `mandate-digest-unknown.yaml` | `-32016` then full-body retry succeeds |
| `mandate-clock-skew.yaml` | `-32017` beyond the ±300 s window |
| `mandate-absent-required.yaml` | `-32010` fail-closed under `enforcement: required` |
