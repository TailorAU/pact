# PACT Governance

**Architecture posture:** PACT is a **vendor-neutral open standard under
federated control**. No customer, vendor, or implementer — *including
Tailor, the largest current customer* — controls the specification, holds
a veto, or receives privileged treatment in the protocol core. This
document is the charter that makes that claim accountable.

It is deliberately honest about what is **in force today** versus what is
**a tracked structural gap**. A governance document that overstates its
own maturity is worse than none.

---

## 1. What "federated control" means here

Control of PACT is not vested in a person or a company. It is vested in
four mechanisms, each independently verifiable by anyone:

1. **A neutral license.** The specification is licensed under
   [`SPEC-LICENSE.md`](SPEC-LICENSE.md) — a perpetual, royalty-free
   copyright **and patent** grant with defensive termination, and an
   explicit refusal to grant the "PACT"/"PACT Conformant" marks as
   leverage. Software is [MIT](LICENSE). No party can retract another
   party's right to implement.
2. **Citation-stable, frozen versions.** Released spec versions
   (`spec/v0.3/`–`spec/v2.0/`) are immutable. Defects are handled
   additively (`ERRATA.md`); new work goes to a new `spec/vX.Y/`
   directory. No one — maintainer or customer — can silently change what
   a shipped version means. (See `AGENTS.md` rules 3–5.)
3. **An open, on-the-record change process.** Every normative change
   originates as a public issue (the `rfc` label for protocol changes),
   is decided in the open, and lands via reviewed change with a recorded
   rationale (`docs/v2-prep/` is the design record). RFC #14 is the
   worked example: a public comment window, a shepherd synthesis, named
   open questions, a stated close date.
4. **Independently checkable conformance.** Conformance is
   **self-declared and externally verifiable** — never certified by a
   gatekeeper. The §15.5 tier probe lets any counterparty *check* a
   claim behaviourally rather than trust it. The conformance suite and
   runner are public and run in CI. "PACT Conformant" is not a mark the
   project grants or sells (`SPEC-LICENSE.md` §4).

These four are **in force today**. They are what make "no privileged
party" true *in the ways an adopter can verify* — license, stability,
process, conformance — regardless of who currently does the maintenance
work.

## 2. Roles

| Role | Who | Power | Not power |
|---|---|---|---|
| **Maintainer** | Currently Knox Hart (sole) | Merges reviewed changes; shepherds RFCs; runs releases and the spec mirror | Cannot change frozen versions; cannot grant/withhold the marks; cannot privilege a customer in the core; cannot bypass the open RFC process for normative change |
| **Contributors** | Anyone | Propose changes via issue/RFC + PR; inbound = outbound under the project licenses | — |
| **Implementers** | Anyone | Implement royalty-free; self-declare a conformance tier; list in [`IMPLEMENTERS.md`](IMPLEMENTERS.md) | Cannot claim certification or exclusive conformance authority |
| **Customers (incl. Tailor)** | Commercial consumers | Shape the roadmap **through the open process**, like any contributor; their production feedback is high-signal input (see issue #13) | **No control, no veto, no privileged core treatment.** Customer needs that are domain-specific land as *extensions*, not core (recorded decision D2=B) |

**The Tailor distinction, stated plainly.** Tailor is the largest
customer and `TailorAU/tailor-app` is *a* reference implementation. That
must not become control. Tailor's needs are served *as a customer and
implementer* and influence the roadmap *only through the same public
process available to anyone* — not via privileged maintainership, not via
the core. Domain-specific Tailor requirements are extensions
(D2=B: the attached-resource model is a Tailor extension, **not** PACT
core). The maintainer happening to also work in the Tailor orbit is
exactly why mechanisms (1)–(4) above, not trust, are the guarantee.

## 3. Change process

1. **Propose** — open an issue. Protocol/wire/schema changes get the
   `rfc` label and are discussed before code.
2. **Shepherd** — substantive RFCs get a written synthesis recording the
   options, the decision, named open questions, and a comment window.
3. **Decide in the open** — the rationale is recorded in
   `docs/v2-prep/`. Maintainer sign-off is required for normative text;
   the maintainer does not freehand normative changes (`AGENTS.md`
   rule 5).
4. **Land** — reviewed PR to `main` (canonical), then mirrored to any
   downstream copy via `tools/mirror-spec.ps1`. `pact-repo` is the
   single source of truth.
5. **Release** — new normative work in a new `spec/vX.Y/` directory;
   frozen versions stay frozen; CHANGELOG + tag + release notes.

A clarifying question never stops a clock; only a substantive design
objection does.

## 4. Structural gaps — tracked, not hidden

Choosing "federated control" exposes a real gap between the **process
neutrality** that is in force (§1) and the **structural neutrality** that
is not yet:

- The specification copyright is held by **Tailor Intelligence Pty Ltd**
  (a Tailor-family entity), the canonical repository lives under the
  **TailorAU** GitHub org, and there is a single maintainer. To an
  external prospect's diligence, that *reads* as vendor capture even
  though the license and process are neutral.
- Resolving this — a neutral custodial home for the copyright and
  canonical repo, a defined path to multi-party maintainership, and the
  unresolved **`pact.io` name collision** (an open standard needs an
  unambiguous, defensible identity) — involves legal and entity
  decisions that are the owner's call, not an agent's.

These are tracked publicly (see the governance tracking issue) and
deliberately surfaced here. Until they are resolved, this document's
honest claim is: **PACT is process-, license-, and conformance-neutral
today, with structural/custodial neutrality as a committed, tracked
trajectory — not a present fact.** Adopters should weigh it as such.

## 5. Amending this document

Changes to governance follow the same open process (§3) and require an
issue with the `rfc` label. Governance is not changed silently or
unilaterally — that would defeat its purpose.
