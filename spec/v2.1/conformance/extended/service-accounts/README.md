# §22 conformance vectors — Service-Account Authentication (v2.1)

Vectors for the scoped-key service-account model (§22).

The load-bearing rule in §22 is **negative**: a service account is transport
identity and is **never** a substitute for proof of human intent (§22.2). An
implementation that accepts service-account auth in place of a §17.6
`authorization_proof` on a cross-organisation message is non-conformant, and
that is the failure worth catching — it converts an authentication convenience
into an authorization bypass.

`service-account-scope-widening-forbidden` covers the other structural rule:
scope may narrow, never widen, so the audit trail always shows the grant.

A cross-org "service-account auth does not substitute for authorization_proof"
vector belongs here too. It needs a two-organisation fixture (two servers, two
principal registries), which the current single-server harness cannot express —
recorded here rather than quietly omitted.
