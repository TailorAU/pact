# §19–§20 conformance vectors — Parleys and Mandates (v2.1)

Vectors for the v2.1 Parley lifecycle (§19) and Mandate enforcement (§20).

## Fail-closed posture

Mandate-enforcement vectors are **fail-closed**. An implementation whose Mandate
verifier is unimplemented MUST fail these vectors — it must never pass them by
default. This mirrors the §18.3 voice-biometric contract: an unimplemented
verifier is `unverifiable`, never `verified`.

Concretely, `parley-mandate-alg-disallowed` and `parley-mandate-expired-rejected`
are the two that catch a no-op verifier: both present a Mandate that MUST be
rejected, so a server that skips verification and accepts everything fails them.

## Runner-kind note (known gap)

`docs/v2-prep/v2.1-scope.yaml` anticipates a dedicated conformance-runner kind
for Mandate enforcement, analogous to the v2.0.3 `kind: session` added for §4.4.
That runner work is **not** done — the runner in `../../runner/` supports
`http`, `verification`, and `session` only, and **fails** on an unknown kind.

These vectors therefore use `kind: http` and `kind: session`, which express the
lifecycle and enforcement assertions adequately today. Adding a first-class
`kind: mandate` (so envelope evaluation can be driven directly, without a live
server) is tracked as follow-on work and is a prerequisite for claiming full
§20.7 coverage.

## Server-bound

All vectors here are server-bound: they SKIP without `--server`. The reference
server in `reference-server/` does **not** implement §19–§22 yet, so these are
not wired into the `conformance-server` CI job. They execute once an
implementation advertising `capabilities.parleys` is available to point at.
