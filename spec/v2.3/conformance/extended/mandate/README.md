# Mandate conformance vectors (§19–§20)

Twelve vectors for the Mandate primitive (spec/v2.3 §19–§20) at its canonical
carriage boundary — the **`au.tailor.pact/mandate`** MCP extension
([`docs/v2-prep/rfc-mcp-mandate-extension.md`](../../../../../docs/v2-prep/rfc-mcp-mandate-extension.md)).

## Provenance

Promoted from [`docs/v2-prep/mandate-mcp-vectors/`](../../../../../docs/v2-prep/mandate-mcp-vectors/)
(authored with the reference implementation in PR
[#42](https://github.com/TailorAU/pact/pull/42), incubating on the
`matters-vectors/` pattern), as part of the [#35](https://github.com/TailorAU/pact/issues/35)
normative delivery. The incubation copies remain in `docs/v2-prep/` as the
design record; **this directory is the normative set.**

Changes made at promotion (everything else is verbatim):

- `metadata.id` renamed `extended/mandate-mcp/<name>` → `extended/mandate/<name>`
  to match this directory (the incubation README predicted `mandate-mcp/`; the
  normative §20 text names the family `mandate`).
- `metadata.spec_section` now leads with the normative sections
  (`spec/v2.3 §19.x / §20.x`); the extension-RFC references are retained after
  them.
- `mandate-revoked-midsession.yaml` notes: the fabric-side obligation
  ("terminate the Parley with `outcome=mandate_revoked`") now cites §21.4
  instead of "§19–20 (#35) territory, unauthored".
- `mandate-forged-signature.yaml` / `mandate-digest-unknown.yaml` notes: the
  signature suite and digest are now specified (§20.3, §20.1), so "crypto
  unspecified until #35" wording was replaced. The vectors still pin
  **structural** verification — the reference guard does not yet implement
  §20.3 cryptographic verification, and every verdict is labelled
  `verification: structural` per §20.5. A cryptographic-forgery vector
  (mirroring `verify-fido2-forged-signature`) is future work alongside that
  implementation.

## Format

`kind: mandate` — defined in [`../../test-vector-format.yaml`](../../test-vector-format.yaml)
(added in the same reviewed change, per the incubation plan). Steps run
sequentially against one guard instance with an injected clock
(`mandateGuardAt` in `mcp/src/mandate.ts` is the reference seam).

## Runner status — honest ledger

**No conformance runner executes these yet, and no CI workflow runs them**
(`conformance.yml` targets `spec/v2.0/conformance` only). Every vector is
mirrored by a passing test in `mcp/test/mandate.test.mjs` /
`mcp/test/wire.test.mjs` (locally runnable via `npm test` in `mcp/`). Wiring
`kind: mandate` into `@pact-protocol/conformance-runner` and CI is follow-on
work.

## The twelve vectors

| File | Pins |
|---|---|
| `mandate-valid-passthrough.yaml` | Well-formed mandate, in-envelope call, permitted + verdict stamped (§20.4) |
| `mandate-expired-rejected.yaml` | `-32012` on stale `expires_at`; server clock authoritative (§19.3) |
| `mandate-forged-signature.yaml` | `-32011` structural: required field missing / malformed (§20.4 step 1) |
| `mandate-revoked-key.yaml` | `-32013` against a revoked signing key (§20.3) |
| `mandate-category-denied.yaml` | `-32014` outside `may_publish`, and on category-less publish under a scoped envelope (§19.5 check 1) |
| `mandate-commitment-escalation.yaml` | `input_required` suspension with challenge nonce — never an error (§19.5 check 2, §20.6) |
| `mandate-escalation-retry.yaml` | Nonce-bound retry succeeds; consumed on success; replay `-32018` (§20.6) |
| `mandate-revoked-midsession.yaml` | Pass, revoke, next request rejected — verdicts never cached (§20.4) |
| `mandate-disclosure-redacted.yaml` | `-32015` where redaction is impossible at the boundary (§19.5 check 3) |
| `mandate-digest-unknown.yaml` | `-32016` then full-body retry succeeds (§20.1) |
| `mandate-clock-skew.yaml` | `-32017` on a retry proof's `asserted_at` beyond ±300 s (§20.6, SOQ2) |
| `mandate-absent-required.yaml` | `-32010` fail-closed under `enforcement: required` (§20.2) |
