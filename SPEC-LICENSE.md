# PACT Specification License

This file governs the **PACT specification** — the normative protocol
artifacts in this repository. It is **separate from** the [MIT `LICENSE`](LICENSE),
which governs the **software** in this repository.

## Two licenses, two scopes

| Artifact | License |
|---|---|
| **Specification** — everything under `spec/**` (the `SPECIFICATION.md` prose, the JSON Schemas in `spec/*/schemas/`, the conformance test vectors in `spec/*/conformance/`, and `resource-types.yaml`) | **This Specification License** (below) |
| **Software** — `cli/`, `mcp/`, `reference-server/`, the conformance runner, `tools/`, and all other code | **MIT** (see [`LICENSE`](LICENSE)) |

If an artifact is reasonably both (e.g. a schema file consumed as code), the
recipient may rely on **either** license at their option.

## Definitions

- **"Specification"** — the PACT protocol artifacts identified above, in any
  version published in this repository.
- **"Licensor"** — the copyright holder identified in [`LICENSE`](LICENSE).
- **"Conformant Implementation"** — software that implements the Specification
  (in whole or in relevant part) and does not add to, subtract from, or modify
  the Specification's normative requirements in a way that breaks
  interoperability with other Conformant Implementations.
- **"Necessary Claims"** — patent claims, owned or controlled by the Licensor,
  that are *necessarily* infringed by implementing the Specification, where
  such infringement is unavoidable because there is no commercially reasonable
  non-infringing way to implement the normative requirement. Necessary Claims
  do **not** include claims that would be infringed only by (a) enabling
  technologies that may be necessary to make or use any product implementing
  the Specification but are not themselves expressly described in it, or
  (b) the implementation of other specifications.

## 1. Copyright grant

The Licensor grants you a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable copyright license to use, reproduce, prepare
derivative works of, publicly display, publicly perform, sublicense, and
distribute the Specification **and implementations of it**, including the
right to create and distribute software, products, and other specifications
that implement the Specification.

You may reproduce and distribute verbatim or excerpted copies of the
Specification provided the copyright and license notices are retained.

## 2. Patent grant (royalty-free, with defensive termination)

Subject to the terms of this license, the Licensor grants you a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as
stated in Section 3) patent license under its Necessary Claims to make, have
made, use, offer to sell, sell, import, and otherwise run, modify, and
distribute a Conformant Implementation.

This grant applies only to the extent of the Licensor's Necessary Claims and
only to the portions of an implementation that implement the Specification.

## 3. Defensive termination

If you (or any entity you control) initiate or voluntarily participate in
patent litigation or any other patent-enforcement action against any party
alleging that the Specification, or a Conformant Implementation of it,
directly or indirectly infringes any patent, then all licenses granted to you
under Sections 1 and 2 terminate as of the date such action is filed. This
section does not apply to a defensive counterclaim raised in response to a
patent action first brought against you.

## 4. No trademark license

This license grants **no** rights in the Licensor's names, trademarks,
service marks, or product names, including the term **"PACT"** and any
conformance designation such as **"PACT Conformant"**. Use of those marks —
including any claim of conformance — is governed separately and is not
granted here. You may state, factually and without implying endorsement, that
your software "implements the PACT specification."

## 5. Disclaimer

THE SPECIFICATION IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND TITLE. IN NO EVENT
SHALL THE LICENSOR BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY
ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SPECIFICATION OR ITS USE.

## 6. Contributions

Unless you explicitly state otherwise, any contribution you intentionally
submit for inclusion in the Specification is submitted under the terms of
this Specification License (for spec artifacts) and the MIT `LICENSE` (for
software), with no additional terms — inbound = outbound. You represent that
you are legally entitled to grant the above licenses for your contribution.

---

*Rationale: PACT's value is that anyone can implement it without seeking
permission and without patent ambush. MIT alone is silent on patents; this
grant closes that gap with an explicit royalty-free patent license and an
Apache-style defensive-termination clause, following the pattern used by
W3C, the Model Context Protocol, and A2A. Code stays MIT.*
