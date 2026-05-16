<!--
DRAFT comment for TailorAU/pact#14. The coordinator posts this; the shepherd
does NOT post to GitHub. Posting command (for the coordinator, after Knox
ratifies the verdict and resolves the naming + skew calls):

  gh issue comment 14 --repo TailorAU/pact --body-file docs/v2-prep/rfc-14-comment-draft.md

Before posting, the coordinator should resolve the two bracketed
maintainer-decision placeholders below (the noun and the skew line) per
docs/v2-prep/rfc-14-shepherd-synthesis.yaml SOQ1 / SOQ2. Synthesis and v2.1
scope: docs/v2-prep/rfc-14-shepherd-synthesis.yaml,
docs/v2-prep/v2.1-scope.yaml.
-->

**Shepherd's synthesis and final call — comment window closes 2026-05-26.**

Thanks to everyone who has been watching this. v2.0 shipped with §19–22 reserved precisely so this primitive could land cleanly in `spec/v2.1/` once the RFC converges. We are now 10 days from the close of the comment window, so this comment drives the RFC to a decision.

## Where this stands

The comment window has been open since 2026-05-13 with **no substantive objections filed**. That is not a reason to extend it — the open questions on this RFC are design-internal, not contested, and they have sound proposals on the table (see the RFC body's "Open design questions"). The charter-level decisions this depends on are already resolved: **D3=A** (Mandate is normative, not an addendum) and **D5=A** (peer-to-peer with an opt-in facilitator; always-mediated `MediatedSession` is parked as a later candidate). There is nothing more comment time would resolve.

## The one real issue: "Session" is now an overloaded term

Since this RFC was posted, **v2.0.3 shipped "Fabric Onboarding & Session Awareness"** (§4.4, §6.5, §15.6, §17.13). That layer is titled *"Active Session Manifest Operations"* and v2.0.3 deliberately minted the noun **"fabric"** for "a single resource's coordination context" specifically to keep the word "session" free. Meanwhile §17.6 already lists *"session mandate"* as a message type that may carry an `authorization_proof`.

So "Session" now means three different things, and this RFC's draft uses the bare word for a fourth — the new ephemeral negotiation mode:

| Term in the spec | What it means | Status |
|---|---|---|
| §4.4 "Active Session Manifest" | The *awareness* layer over a long-lived **fabric** | Shipped (v2.0.3), frozen |
| §17.6 "session mandate" / §17.7 "life of a session" | Loose, forward-looking usage | Shipped (v2.0) |
| RFC #14 "PACT Session" | A **new ephemeral negotiation mode** | This RFC |

Shipping the #14 concept under the bare noun "Session" would write a three-way-overloaded core term into normative v2.1 text. A v2.1 reader could not tell "Session Manifest" (§4.4, fabric awareness) from "PACT Session" (§19, an ephemeral negotiation) from the word alone — and could reasonably mis-bind §17.6's "session mandate" to the wrong section.

**Resolution: rename the new concept, not the shipped layer.** v2.0.3 §4.4 is frozen for citation stability and is not being renamed. The new mode is renamed so the bare word "Session" never denotes it in `spec/v2.1/`. The proposed spec-of-record term is **[`Negotiation Session`]** *(maintainer to confirm the final noun)*, and §19 will carry a normative terminology note distinguishing it from §4.4 fabric session-awareness and binding §17.6's "session mandate" reference to §19. This is the headline modification.

## Recommended verdict: ACCEPT WITH MODIFICATIONS

The design is sound, the motivating production gaps are real (AloomU's #13 Q1/Q6/Q7), the charter decisions are resolved, and no objection is on record. It does **not** land as-drafted. It lands with these modifications, after which `spec/v2.1/` normative text is written via the usual coordinated-PR pattern:

1. **Rename** so "Session" never denotes the #14 concept (above).
2. **Compose with v2.0.3, do not duplicate it.** The Mandate is a §17-family object (same trust chain, DID principal model, alg-whitelist discipline, fail-closed verification — it generalises `authorization_proof`, it does not introduce a parallel identity model). Session "state" reuses the §4.4 manifest shape and §17.13 disclosure rules; round expectations are §6.5 pending obligations; liveness is §4.4.3 heartbeat. The only genuinely new normative surface is the Mandate primitive, the ephemeral lifecycle, and the bilateral handshake.
3. **The six open questions are ratified as the design baseline** as proposed in the RFC body — immediate hang-up on mandate revocation (Q1), open-with-deadlock on mandate intersection (Q2), advisory-by-default outcomes (Q3), islanded-by-default with optional predecessor (Q4), peer-to-peer (Q5, already D5-resolved), server-authoritative clock (Q6). Two refinements: a *binding* outcome must be witnessed by a per-handler `authorization_proof` (not merely a Mandate flag — that is the line between this and reinventing contracts over HTTP); and Mandate `expires_at` skew **[aligns to the §17.7 ±5-minute configurable window]** *(maintainer to confirm vs a deliberate tighter session bound)*.
4. **§19–20 and §21 (push delivery) ship together** in `spec/v2.1/` — the Mandate's `escalation_hook` is the push-delivery format, so they are co-designed.

Why not the alternatives: *accept-as-is* knowingly writes an overloaded core noun into normative text; *defer-further* buys nothing (no open question more time would answer, charter decisions locked, zero objections in a third of the window) and is exactly the "Sessions becomes a six-month track" failure mode the plan's R3 warns about; *reject* throws away a primitive that generalises an already-normative §17 concept and closes real production pain.

## Final call

This is the convergence comment. The window closes **2026-05-26 23:59 AEST**. If you have a substantive objection to the verdict above, to the rename, or to any of the four modifications, **raise it on this issue before then**.

"No further substantive objection by 2026-05-26" will be treated as convergence. At that point:

- #14 moves to *accepted — normative text pending*;
- §19–22 normative text is drafted into a **new `spec/v2.1/` directory** (never `spec/v2.0.x/`, never `spec/vX.Y.Z/`) via the coordinated-PR pattern that landed v2.0;
- `spec/v2.0/` stays frozen — v2.1 is carried forward into its own directory, not edited in place.

A clarifying question is not an objection and does not pause the clock — ask freely; the clock only stops for a substantive design objection that needs resolution before normative text can be written.

— Knox / TailorAU
