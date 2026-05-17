# PACT Implementers

A registry of PACT implementations and how to be listed. PACT defines the
protocol; an implementation provides the content layer for its domain.

> Listing here is **not** a certification. "PACT Conformant" is not a
> granted trademark (see [`SPEC-LICENSE.md`](SPEC-LICENSE.md) §4).
> Conformance is **self-declared and independently checkable**: a claimed
> tier can be verified behaviourally via the §15.5 tier probe rather than
> taken on faith.

## Conformance tiers

Defined normatively in the [specification](spec/v2.0/SPECIFICATION.md)
(§15.2, §17.9) — not restated here:

- **Core** — the base coordination primitives.
- **Extended** — Core + information barriers, mediation, structured
  negotiation, invite tokens.
- **Authorization-Required** — Extended + the §17 human-authorization
  layer with behavioural tier introspection (§15.5).

## Reference implementations (this repo)

| Component | Path | Status |
|---|---|---|
| `@pact-protocol/cli` | [`cli/`](cli/) | Built, pinned `2.0.3`; not yet on npm ([#5](https://github.com/TailorAU/pact/issues/5)) |
| `@pact-protocol/mcp` | [`mcp/`](mcp/) | Built, pinned `2.0.3`; not yet on npm ([#5](https://github.com/TailorAU/pact/issues/5)) |
| `@pact-protocol/reference-server` | [`reference-server/`](reference-server/) | In-repo reference server; run against the suite in CI |
| `@pact-protocol/conformance-runner` | [`spec/v2.0/conformance/`](spec/v2.0/conformance/) | Executes the test vectors; gates CI |

These are the *reference* of record, not a third-party implementation —
they exist to make the spec executable and the conformance suite real.

## Independent implementations

| Implementation | Scope | Spec version | Maintainer |
|---|---|---|---|
| [**HMAN**](https://github.com/Tailor-AUS/Human-Managed-Access-Network) | Reference implementation of **§17 Human Authorization Layer** and **§18 Attestation Format** (public, MIT) | v2.0 | Tailor-AUS |
| **Tailor** | `document`, `fact` (content layer) | v1.1 live; v2.0 server-side rollout in progress | TailorAU |

HMAN is deliberately a **separate artifact** from PACT: PACT is the
vendor-neutral protocol; HMAN is the canonical proof that §17/§18 are
implementable on a sovereign, local-first stack. The two are not merged.

## Wanted: a second independent implementation

PACT's neutral-protocol thesis only becomes *demonstrably* true when an
implementation **not built by Tailor** interoperates with another over a
shared resource. If you are building one, you are invited — start at
**Core**, run the §15.5 tier probe so the claim is checkable, and
demonstrate one cross-implementation negotiation. See
[issue #13](https://github.com/TailorAU/pact/issues/13).

## How to get listed

1. Build against the [specification](spec/v2.0/SPECIFICATION.md) and the
   [conformance suite](spec/v2.0/conformance/).
2. Open a PR adding a row to the table above: implementation name, link,
   scope/resource types, the conformance tier you target, and maintainer.
3. State your tier claim; expose the §15.5 tier probe so it is
   independently verifiable. Self-declared, externally checkable — no
   gatekeeper, no rubber stamp.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution flow.
