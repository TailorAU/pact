# RFC: `au.tailor.pact/mandate` — a PACT Mandate extension for MCP

> **Status:** RFC — for discussion. No normative text lands until RFC #14 converges.
> **Extension identifier:** `au.tailor.pact/mandate`
> **Target MCP revision:** `2026-07-28`
> **Target PACT version:** v2 (§19–20)
> **Owner:** Knox Hart
> **Related:** PACT RFC #14 (Sessions + Mandates), T11 gap G3, PACT §17 `authorization_proof`
> **Intended home:** `docs/v2-prep/rfc-mcp-mandate-extension.md` in `TailorAU/pact`

---

## 1. Summary

This extension carries a PACT **Mandate** — a handler-signed capability grant —
on every MCP request, and defines what an MCP server must do when a tool call
exceeds it.

It is a binding, not a new governance model. The Mandate primitive is specified
by PACT RFC #14. MCP `2026-07-28` supplies three mechanisms that did not exist
when that RFC was written: a formal extensions framework, per-request `_meta`,
and Multi Round-Trip Requests. This document maps one onto the other.

## 2. Motivation

PACT governs what agents may do inside a PACT fabric. MCP governs how agents
reach tools. Today an agent operating under a PACT mandate loses that mandate
the moment it calls a non-PACT MCP server — the authority context stops at the
protocol boundary.

That gap is the whole problem. An agent can be tightly bounded inside a PACT
negotiation and completely unbounded one tool call later. Governance that only
holds within its own protocol is not governance; it is a convention.

Three changes in MCP `2026-07-28` make closing this gap tractable:

1. **The extensions framework** (SEP-2133) gives third-party protocol additions
   a defined, namespaced place to live, with no central registry required.
2. **Statelessness** (SEP-2575) removed the `initialize` handshake. Client
   capabilities and protocol version now travel in `_meta` on *every* request.
   Authority context is no longer negotiated once and assumed thereafter.
3. **Multi Round-Trip Requests** (SEP-2322) let a server return
   `resultType: "input_required"` and suspend a call pending information from
   the client — the exact shape of "a human must approve this before I proceed."

Point 2 deserves emphasis. Under the old session model, a mandate agreed at
handshake would have to be trusted for the life of the connection. Per-request
`_meta` makes the mandate checkable on every single call. The stateless
rewrite, which looks like a cost elsewhere, is a direct benefit here.

## 3. Relationship to existing PACT primitives

PACT already has two layers of human authority. This extension adds no third.

| Primitive | Attests | Scope | Spec |
|---|---|---|---|
| `authorization_proof` | "a human authorised *this message*" | one operation | §17 |
| `mandate` | "a human authorised *this agent, within these bounds, until this time*" | a session | §19–20 (RFC #14) |
| **this extension** | *carriage of the above across an MCP boundary* | one MCP request | — |

The trust chain is unchanged: handler signs, server verifies. What changes is
that the envelope now travels on MCP requests to servers that are not PACT
fabrics.

**Non-goal:** this extension does not sign mandates. Signing is the
hardware/biometric layer (§17.3). As with the CLI's `--authorization-proof`,
implementations **carry** a pre-built, pre-signed mandate; they never mint one.

## 4. Extension identifier

```
au.tailor.pact/mandate
```

Reverse-DNS of `pact.tailor.au`, the spec's canonical host. SEP-2133 mandates no
central registry and performs no key-format validation, so this identifier is
usable immediately without approval from anyone.

The namespace belongs to **PACT**, not to Tailor. PACT is MIT-licensed and
vendor-neutral; Tailor is one implementer among others. An extension namespaced
under a consuming platform would be a vendor extension, which is a materially
weaker position — and inconsistent with `IMPLEMENTERS.md`.

## 5. Capability declaration

Servers that enforce mandates **MUST** advertise the extension in
`ServerCapabilities.extensions`, returned from `server/discover`:

```json
{
  "capabilities": {
    "extensions": {
      "au.tailor.pact/mandate": {
        "specVersion": "2.2",
        "enforcement": "required",
        "acceptedSigningAlgs": ["EdDSA", "ES256"],
        "principalRegistry": "https://pact.tailor.au/.well-known/principals",
        "maxClockSkewMs": 30000
      }
    }
  }
}
```

Field semantics:

- **`specVersion`** (REQUIRED) — PACT spec version whose Mandate shape is accepted.
- **`enforcement`** (REQUIRED) — one of:
  - `"required"` — requests without a valid mandate are rejected.
  - `"optional"` — mandates are verified when present, absent is permitted.
  - `"observed"` — mandates are recorded for provenance but never cause rejection.
- **`acceptedSigningAlgs`** (REQUIRED) — signature algorithms the server will verify.
- **`principalRegistry`** (OPTIONAL) — where the server resolves `handler_principal_id`.
- **`maxClockSkewMs`** (OPTIONAL, default `30000`) — matches RFC #14 open question 6.

Clients declare support in `ClientCapabilities.extensions` with the same key and
an empty object when they carry mandates but impose no settings.

A server advertising `enforcement: "required"` **MUST NOT** also serve requests
that omit the mandate, including from clients that did not declare the extension.
Fail closed. A governance extension that degrades to open on client silence is
worse than none, because it reads as enforced when it is not.

## 6. Request carriage

The mandate rides in `_meta` on every request, alongside
`io.modelcontextprotocol/clientCapabilities` and OpenTelemetry's `traceparent`:

```json
{
  "method": "tools/call",
  "params": {
    "name": "pact_escalation_resolve",
    "arguments": { "documentId": "…", "decision": "…" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "traceparent": "00-4bf92f…-00f067aa0ba902b7-01",
      "au.tailor.pact/mandate": {
        "version": "1",
        "session_id": "sess_xyz",
        "agent_id": "agent_abc",
        "handler_principal_id": "did:web:knox.example",
        "identity_claim": "this agent represents Knox on API contract negotiation",
        "constraint_envelope": {
          "may_publish": ["interface", "performance", "security"],
          "must_respect": [
            { "boundary": "no breaking changes to event v1 schema" }
          ]
        },
        "commitment_authority": {
          "max_binding_decisions": 1,
          "binding_scope": "interface contract draft"
        },
        "disclosure_ceiling": 2,
        "escalation_hook": "https://my-relay.example/agent_abc/escalations",
        "expires_at": "2026-08-12T18:00:00Z",
        "signature": "base64url-…",
        "signing_key_id": "did:web:knox.example#key-1"
      }
    }
  }
}
```

The body is the Mandate primitive from RFC #14 **verbatim**. This extension adds
no fields. If RFC #14 changes the shape, this document follows it; the two must
not drift.

Servers **SHOULD** echo the mandate's `session_id` and a verification verdict in
each result's `_meta` under the same key, so the decision is auditable from the
transcript alone:

```json
"_meta": {
  "au.tailor.pact/mandate": {
    "session_id": "sess_xyz",
    "verified": true,
    "verified_at": "2026-07-29T04:11:07Z"
  }
}
```

### Size

A mandate with a populated `constraint_envelope` is not small, and it now rides
on every request rather than once per session. Servers **MAY** advertise
`"digestMode": true` in their capability object, in which case clients send the
full mandate on first use and a `{ session_id, digest }` pair thereafter, where
`digest` is the SHA-256 of the canonical mandate body. Servers supporting digest
mode **MUST** return `MandateDigestUnknown` (§9) if they have not seen the full
mandate, and clients **MUST** then retry with it. This preserves statelessness:
the digest is a cache hint, never a session.

## 7. Server obligations

A server advertising `enforcement: "required"` or `"optional"` **MUST**, on every
request bearing a mandate, and **before** executing any tool side effect:

1. Verify `signature` over the canonical mandate body using `signing_key_id`,
   resolved via `principalRegistry` where configured. Reject on failure.
2. Reject if `expires_at` has passed in **server** time. Server clock is
   authoritative (RFC #14 Q6). Reject if client-asserted time drifts beyond
   `maxClockSkewMs`.
3. Reject if `signing_key_id` is revoked or tombstoned, per §17.7 step 5.
4. Evaluate the call against `constraint_envelope`, `commitment_authority` and
   `disclosure_ceiling` (§8).
5. Record the verdict for provenance, whether or not it permitted the call.

Verification **MUST** be performed per request. Servers **MUST NOT** cache a
verification verdict across requests — only, under digest mode, the mandate body
itself. This is what makes revocation immediate (§10).

## 8. Evaluating a call against the envelope

Three checks, in order. The first that fails determines the outcome.

**Constraint envelope.** If the tool call publishes into a category absent from
`may_publish`, reject with `MandateCategoryDenied`. `must_respect` boundaries are
natural-language assertions and are **not** machine-evaluable; servers **MUST NOT**
claim to enforce them. They are carried for the human at the escalation point,
and for the record. Overstating this would be the single easiest way to make the
extension dishonest.

**Commitment authority.** If the call would exceed `max_binding_decisions`, or
falls outside `binding_scope`, the server **MUST NOT** reject outright. It
**MUST** escalate (§9). This is the substantive difference between a mandate and
an ACL: exceeding a mandate is a request for human authority, not an error.

**Disclosure ceiling.** If the call would return content above
`disclosure_ceiling` (§10.3 graduated disclosure levels 1–4), the server **MUST**
either redact to the ceiling and set `"redacted": true` in the result `_meta`, or
escalate. Servers **MUST NOT** return above-ceiling content unredacted.

Note that `disclosure_ceiling` and PACT clearances are different mechanisms and
both apply. A clearance is what the agent is *permitted* to see on a resource; a
disclosure ceiling is what this *mandate* allows it to reveal in this session.
The effective limit is the lower of the two.

## 9. Escalation via MRTR

This is the substantive contribution of this document.

RFC #14 routes mandate escalation through `escalation_hook`, an out-of-band
webhook. That remains correct for asynchronous outcomes. But MCP `2026-07-28`
removed server-initiated requests entirely and replaced them with Multi Round-Trip
Requests — and MRTR is a better fit for the synchronous case, because the call
suspends rather than failing.

When a call exceeds `commitment_authority`, the server **MUST** return:

```json
{
  "resultType": "input_required",
  "inputRequests": [
    {
      "type": "au.tailor.pact/mandate-escalation",
      "reason": "commitment_authority_exceeded",
      "detail": {
        "requested": "binding commitment on pricing terms",
        "binding_scope": "interface contract draft",
        "max_binding_decisions": 1,
        "decisions_used": 1
      },
      "requires": "authorization_proof",
      "escalation_hook_notified": true
    }
  ],
  "requestState": "opaque-server-token"
}
```

The client obtains a fresh `authorization_proof` (§17) from its handler through
whatever human-approval path it implements, then **retries the original request**
with `inputResponses` carrying the proof. The server verifies the proof and
proceeds.

Why this matters:

- **The call is suspended, not failed.** The agent does not have to reconstruct
  intent after an error. It waits.
- **`authorization_proof` is exactly the right currency.** §17 already means
  "a human authorised this specific message." An over-mandate call is precisely
  a message needing its own authorisation. The two primitives compose without
  either being extended.
- **`requestState` carries the correlation.** RFC #14's open question about
  correlating an elicitation across retries is answered by MCP: the server
  encodes its own identifier in `requestState`. MCP `2026-07-28` removed
  `elicitationId` for exactly this reason.
- **The mandate invariant becomes protocol.** "Agents propose; a human approves;
  approval grants a single-use mandate" stops being a workspace convention and
  becomes a wire-level obligation any compliant server enforces.

Servers **SHOULD** still notify `escalation_hook`, and **MUST** set
`escalation_hook_notified` truthfully. The hook and MRTR are complementary: the
hook tells the handler out-of-band, MRTR holds the call open.

## 10. Revocation

RFC #14 open question 1 asks whether a mid-session revocation hangs up
immediately or finishes the current round, and proposes immediate hang-up.

**Under MCP `2026-07-28`, immediate is the only reachable answer, and it is free.**
Because the protocol is stateless and §7 requires per-request verification, there
is no session to finish. The next request after revocation fails verification.
There is no in-flight authority to wind down, because authority was never held
between requests.

This is worth feeding back into RFC #14: the stateless binding turns a contested
design question into a property of the transport. The RFC's concern — "the agent
committing under an authority that no longer exists" — cannot arise, because
every commitment re-presents the authority.

The caveat is digest mode (§6). A server caching mandate *bodies* by digest must
still re-verify expiry and revocation per request. Caching the body is
permitted; caching the verdict is not.

## 11. Error codes

MCP `2026-07-28` partitions the JSON-RPC server-error range: `-32000` to `-32019`
is implementation-defined, `-32020` to `-32099` is reserved to the MCP
specification. Extension errors therefore live in the low range.

| Code | Name | Meaning |
|---|---|---|
| `-32010` | `MandateRequired` | Server is `enforcement: "required"`; no mandate present |
| `-32011` | `MandateInvalidSignature` | Signature failed verification |
| `-32012` | `MandateExpired` | `expires_at` has passed in server time |
| `-32013` | `MandateRevoked` | `signing_key_id` revoked or tombstoned |
| `-32014` | `MandateCategoryDenied` | Call publishes outside `may_publish` |
| `-32015` | `MandateDisclosureExceeded` | Would disclose above ceiling, redaction impossible |
| `-32016` | `MandateDigestUnknown` | Digest mode; server has not seen this mandate body |
| `-32017` | `MandateClockSkew` | Client time drift exceeds `maxClockSkewMs` |

Exceeding `commitment_authority` is **not** in this table. It is not an error —
it returns `input_required` (§9).

## 12. Conformance

Mirrors PACT's existing three levels:

- **Core** — MAY ignore the extension entirely. Core implementations remain
  resource-only and are unaffected.
- **Extended** — SHOULD advertise the extension. If advertised, MUST implement
  §7 verification and §9 escalation in full.
- **Authorization-Required** — MUST advertise with `enforcement: "required"`,
  and MUST reject unsigned or unverifiable mandates across organisational
  boundaries.

Test vectors belong in `spec/v2.2/conformance/extended/mandate-mcp/`, following
the existing `test-vector-format.yaml`. Minimum set:

| Vector | Asserts |
|---|---|
| `mandate-valid-passthrough` | Well-formed mandate, in-envelope call, permitted |
| `mandate-expired-rejected` | `-32012` on stale `expires_at` |
| `mandate-forged-signature` | `-32011`, mirroring `verify-fido2-forged-signature` |
| `mandate-revoked-key` | `-32013` against a tombstoned key |
| `mandate-category-denied` | `-32014` on out-of-envelope publish |
| `mandate-commitment-escalation` | `input_required`, not an error |
| `mandate-escalation-retry` | Retry with `authorization_proof` in `inputResponses` succeeds |
| `mandate-revoked-midsession` | Request N permitted, revocation, request N+1 rejected |
| `mandate-disclosure-redacted` | Above-ceiling content redacted, `redacted: true` set |
| `mandate-digest-unknown` | `-32016` then successful retry with full body |
| `mandate-clock-skew` | `-32017` beyond `maxClockSkewMs` |
| `mandate-absent-required` | `-32010` when `enforcement: "required"` |

## 13. What this unblocks

T11 gap **G3** lists `pact_session_*` MCP tools as blocked on RFC #14 converging.
This document is orthogonal to that and not blocked by it: G3 adds *tools for
managing* sessions; this extension carries the *mandate* on requests to any
server, including servers with no session tools at all.

The two compose. G3 gives an agent `pact_session_create`. This extension makes
every subsequent call — to PACT servers and to unrelated MCP servers alike —
carry and honour the mandate that session produced.

It also gives `@pact-protocol/cli` a `pact mandate verify <file>` command with
identical semantics to the existing `pact verify-proof`, reusing `cli/src/proof.ts`.
That keeps the CLI at parity with the MCP surface, which T11 G7 established as
the standing requirement.

## 14. Non-goals

- **Minting or signing mandates.** Carriage only (§3).
- **Enforcing `must_respect` boundaries.** Natural language, carried not evaluated (§8).
- **Replacing `escalation_hook`.** MRTR handles the synchronous case; the hook
  remains for asynchronous outcomes (§9).
- **A Tailor-specific extension.** The namespace is PACT's. Tailor implements it
  like any other implementer.
- **Content operations.** Per T11's standing rule, coordination primitives only —
  propose/approve/merge stay implementation-side.

## 15. Open questions

1. **Mandate size on every request.** Is digest mode (§6) sufficient, or should
   the mandate be fetchable by reference from `principalRegistry`? Reference
   fetching reintroduces a network dependency on the hot path.
2. **Cross-server mandate scope.** A mandate names a `session_id` in one PACT
   fabric. When carried to an unrelated MCP server, what does `binding_scope`
   mean there? Options: scope is advisory outside the issuing fabric; or
   mandates carry an explicit `audience` list. The second is stricter and
   probably right, but adds a field to RFC #14 — which §6 says must not drift.
3. **Client-side enforcement.** Should a compliant *client* refuse to send a
   call it can see exceeds its own mandate, or always let the server decide?
   Server-decides is simpler and harder to subvert; client-side is cheaper and
   gives better agent ergonomics. Probably both, with server authoritative.
4. **Relationship to Enterprise Managed Authorization.** ~~Overlap needs
   mapping before an SEP.~~ **Resolved 2026-07-29 against the stable EMA spec**
   (`modelcontextprotocol/ext-auth`,
   `specification/stable/enterprise-managed-authorization.mdx`): EMA operates
   entirely at the HTTP authorization layer — OIDC/SAML SSO, RFC 8693 token
   exchange to an ID-JAG, RFC 7523 presentation. Its own text states the IdP's
   visibility "does not extend to the actual MCP traffic between the MCP Client
   and Server." Per-request behavioural constraints, runtime approval of
   individual tool calls, and capability envelopes are explicitly out of its
   scope. The two are complementary layers, not competitors: **EMA authorises
   the connection; the mandate governs the conduct.** A production deployment
   uses both — EMA (or `X-Api-Key`, or any transport auth) decides whether the
   client may reach the server at all; this extension decides what the agent may
   do on each call and when a human must approve. No layering rework required.
5. **`enforcement: "observed"`.** Useful for adoption, but a server that records
   and never rejects may still be described as "PACT-governed". Should the
   conformance profile forbid that label at `observed`?

## 16. Path to standardisation

Two tiers, in order:

1. **Vendor extension, now.** No permission required. Ship under
   `au.tailor.pact/mandate`, implement in `@pact-protocol/mcp`, add conformance
   vectors, list implementers. Adoption is the only evidence that matters.
2. **Standards Track SEP, later.** Official extensions live in
   `github.com/modelcontextprotocol/ext-*` and require a sponsor. Worth pursuing
   only with implementations in hand. The natural home would be alongside EMA in
   the authorization extensions family — EMA governs access, this governs
   conduct (open question 4, resolved).

The honest constraint: **an extension has force only where clients implement it.**
A mandate no client honours is provenance metadata, not governance. Tier 1 is
therefore not a stepping stone to tier 2 — it is the test of whether tier 2 is
worth attempting at all.

---

## Appendix: mechanisms this depends on

| Mechanism | SEP | What it provides |
|---|---|---|
| Extensions framework | [SEP-2133](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2133) | `extensions` on Client/ServerCapabilities, reverse-DNS keys, no registry |
| Stateless core | [SEP-2575](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575) | `_meta` per request; `server/discover`; no session |
| Multi Round-Trip Requests | [SEP-2322](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2322) | `input_required`, `inputRequests`, `requestState` |
| Error code policy | [changelog §12](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | `-32000`–`-32019` implementation-defined |
| PACT Mandate | RFC #14 | The envelope itself — carried verbatim |
| PACT `authorization_proof` | §17 | Per-message human authorisation, used at escalation |
| Enterprise Managed Authorization | [ext-auth](https://github.com/modelcontextprotocol/ext-auth) | Complementary, not overlapping: HTTP-layer access-token issuance (ID-JAG); no visibility into MCP traffic |
