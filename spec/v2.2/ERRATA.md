# PACT v2.2 — errata

> Errata for the stable v2.2 specification. This file is **additive** — it
> documents known issues in [`SPECIFICATION.md`](./SPECIFICATION.md), its
> schemas and [`resource-types.yaml`](./resource-types.yaml) **without
> amending them**. Per [AGENTS.md](../../AGENTS.md) rules 3–4 and
> [GOVERNANCE.md](../../GOVERNANCE.md) §1(2), a version promoted to stable is
> not silently rewritten; defects are disclosed here and fixed in the next
> line. This note is the canonical disclosure for v2.2 readers.
>
> **Fix location:** [`../v2.3/SPECIFICATION.md` §25](../v2.3/SPECIFICATION.md)
> and §17.14 (DRAFT at the time of writing).
> **Public record:** [TailorAU/pact#41](https://github.com/TailorAU/pact/issues/41).

## E1 — Protocol states read as legal signature, assent, or side-effect authority

**Severity: safety.** This erratum concerns text that can lead an implementer
to perform an irreversible real-world action, or to represent a coordination
state as a legal act. Read it before building a v2.2 implementation that
touches money, external systems, or instruments.

### The defect

PACT v2.2 borrows a coordination vocabulary from domains where the same words
carry legal weight, and never says that the weight is not carried across. Four
places in the stable text make the wrong reading available:

| Location | Text | Wrong reading it permits |
|---|---|---|
| [`SPECIFICATION.md`](./SPECIFICATION.md) §5, Approval Policy table | `objection-based` — "Auto-merge after TTL unless an agent objects (silence = consent)" | Silence is a party's *consent* |
| [`SPECIFICATION.md`](./SPECIFICATION.md) §10.5 | Diagram caption "(silence = consent)" | As above |
| [`SPECIFICATION.md`](./SPECIFICATION.md) §14.5, primitives table | `silence = consent` row maps to "**Auto-authorize after TTL**" (transaction) and "Auto-verify after TTL" (fact) | A TTL expiry settles a payment |
| [`SPECIFICATION.md`](./SPECIFICATION.md) §15.2, Conformance Levels | Core requires "silence-based auto-apply", unqualified as to what is being applied | Silence-based auto-apply of *any* effect is required for Core conformance |

Compounding them, §17.6–§17.7 define what a verified `authorization_proof`
*is* but never state what it is **not**, leaving available the inference that a
verified proof establishes legal identity, role, capacity, authority to bind an
entity, intention to sign an instrument, or enforceability. It establishes
none of those.

The dangerous composite: an implementer wires a `transaction` resource to a
treasury system, copies the `objection-based` policy from the document
examples, reads §14.5's "Auto-authorize after TTL" as normative, and ships a
system where nobody objecting for sixty seconds moves money — with an audit
trail that reads as though a human approved it.

### Reader guidance (normative for v2.2 implementations, by disclosure)

These constraints are how §5, §10.5, §14.5, §15.2 and §17 of v2.2 are to be
read. They restate what the specification always intended; they do not add a
new capability, and none of them is a licence to change the frozen text.

1. **"Silence = consent" means absence of protocol objection within the TTL
   window.** It is not consent in any legal sense, not an act of a human, and
   not evidence that any human saw the proposal.

2. **`accepted`, `approved`, `auto-merged`, `merged`, `aligned`,
   `consensus_reached`, `commitment`, `Settled`, `Verified`, `Finalized`, a
   `done` completion, TTL expiry and absence of objection are protocol states
   only.** None is, by itself, an electronic signature, execution of an
   instrument, legal assent, proof of identity or capacity, or authority to
   bind a person or entity.

3. **Silence, TTL expiry, consensus and automated agent votes MUST NOT create
   or substitute for an `authorization_proof`.** A message without a proof is a
   message with no human attestation, and MUST be recorded as such.

4. **Do not read §14.5's "Auto-authorize after TTL" as permission to settle,
   execute, or perform any external or irreversible effect.** An implementation
   MUST fail closed pending an explicit, payload-bound human attestation plus
   its own application-layer authority checks, or declare the effect outside
   PACT and hand it to a separate execution system. §15.2's "silence-based
   auto-apply" is to be read as scoped to effects that are internal to the
   implementation and reversible from its own event log.

5. **A verified §17 `authorization_proof` proves only that the identified
   HumanPrincipal authorized that exact PACT message.** It does not establish
   legal identity, role or capacity, authority to bind an entity, intention to
   sign a particular instrument, satisfaction of witnessing / countersignature
   / statutory formalities, or enforceability.

6. **A document may reach consensus and be merged or finalised as a draft.** It
   MUST NOT be labelled `signed`, `executed`, or legally `accepted` unless a
   separately advertised execution capability has captured each required
   signer's intentional act and retained the evidence.

### What changed where

The normative fix is [`../v2.3/`](../v2.3/): §25 (the safety boundary and the
fail-closed apply guard), §17.14 (the `authorization_proof` scope limit), the
machine-readable `effect_class` / `human_attestation` fields in
[`../v2.3/resource-types.yaml`](../v2.3/resource-types.yaml), and the
`extended/execution-boundary/` conformance vectors.

**v2.2 itself is unchanged and remains citable.** An implementation that
follows the six points above is behaving as v2.3 requires while remaining a
v2.2 implementation. An implementation that today auto-applies an external or
irreversible effect from silence should treat that as a defect to fix now, not
at upgrade time.

### Scope note

This erratum does not define jurisdiction-specific electronic-signature law,
determine corporate authority, or make PACT a document-signing product. It
records what PACT's own states and attestations do — and do not — authorize.

---

*Last updated: 2026-07-30.*
