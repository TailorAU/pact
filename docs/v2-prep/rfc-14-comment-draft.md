<!--
FINAL comment for TailorAU/pact#14, ready to post. The coordinator posts this;
the shepherd does NOT post to GitHub. Posting command (for the coordinator,
once Knox has ratified the verdict — the SOQ1 naming and SOQ2 skew calls are
already resolved and filled in below):

  gh issue comment 14 --repo TailorAU/pact --body-file docs/v2-prep/rfc-14-comment-draft.md

The two maintainer-decision points are RESOLVED and inlined: SOQ1 noun =
"Parley"; SOQ2 skew = reuse §17.7's ±5min Mandate clock-skew window (the RFC's
tighter 30s is NOT adopted). No bracketed placeholders remain. Synthesis and
v2.1 scope: docs/v2-prep/rfc-14-shepherd-synthesis.yaml,
docs/v2-prep/v2.1-scope.yaml.
-->

**Shepherd's synthesis and final call — comment window closes 2026-05-26.**

Thanks to everyone who has been watching this. v2.0 shipped with §19–22 reserved precisely so this primitive could land cleanly in `spec/v2.1/` once the RFC converges. We are now 10 days from the close of the comment window, so this comment drives the RFC to a decision.

## Where this stands

The comment window has been open since 2026-05-13 with **no substantive objections filed**. That is not a reason to extend it — the open questions on this RFC are design-internal, not contested, and they have sound proposals on the table (see the RFC body's "Open design questions"). The charter-level decisions this depends on are already resolved: **D3=A** (Mandate is normative, not an addendum) and **D5=A** (peer-to-peer with an opt-in facilitator; always-mediated `MediatedSession` is parked as a later candidate). There is nothing more comment time would resolve.

## The one real issue: "Session" / "Negotiation" is an overloaded term

Since this RFC was posted, **v2.0.3 shipped "Fabric Onboarding & Session Awareness"** (§4.4, §6.5, §15.6, §17.13). That layer is titled *"Active Session Manifest Operations"* and v2.0.3 deliberately minted the noun **"fabric"** for "a single resource's coordination context" specifically to keep the word "session" free. Meanwhile §17.6 already lists *"session mandate"* as a message type that may carry an `authorization_proof`, and §13 already owns *"negotiation"* — the §13.5.3 `negotiation.open` / §13.6 Mediator-driven multi-round exchange.

So the new primitive sits between two existing collisions: "Session" is taken by §4.4, and "Negotiation" is taken by §13:

| Term in the spec | What it means | Status |
|---|---|---|
| §4.4 "Active Session Manifest" | The *awareness* layer over a long-lived **fabric** | Shipped (v2.0.3), frozen |
| §17.6 "session mandate" / §17.7 "life of a session" | Loose, forward-looking usage | Shipped (v2.0) |
| §13.5.3 `negotiation.open` / §13.6 Mediator API | The *mediated negotiation rounds* on a contested section | Shipped (v2.0) |
| RFC #14 primitive | A **new ephemeral, caller-initiated negotiation primitive** | This RFC |

Shipping the #14 concept under the bare noun "Session" would write an overloaded core term into normative v2.1 text — a reader could not tell "Session Manifest" (§4.4, fabric awareness) from a §19 "Session" from the word alone, and could reasonably mis-bind §17.6's "session mandate" to the wrong section. A "Negotiation"-derived name would not be safe either: it would collide instead with the §13 mediated negotiation rounds.

**Resolution: name the new concept with a distinct word, do not rename the shipped layers.** v2.0.3 §4.4 and the §13 negotiation rounds are both frozen for citation stability and are not being renamed. The decided noun is **`Parley`** (capitalized "Parley"; the operation/object is "a Parley"; plural "Parleys"). **"Parley" was chosen because it is collision-free with BOTH the shipped v2.0.3 §4.4 fabric *session-awareness* layer AND the §13 mediated *negotiation* rounds — a distinct word avoids the double-collision a "Session"- or "Negotiation"-derived name would have caused.** §19 will be titled "Parleys" and carry a normative terminology note distinguishing the Parley from §4.4 fabric session-awareness and from §13 negotiation rounds, and binding §17.6's "session mandate" reference to §19 (the Parley). This is the headline modification.

## Recommended verdict: ACCEPT WITH MODIFICATIONS

The design is sound, the motivating production gaps are real (AloomU's #13 Q1/Q6/Q7), the charter decisions are resolved, and no objection is on record. It does **not** land as-drafted. It lands with these modifications, after which `spec/v2.1/` normative text is written via the usual coordinated-PR pattern:

1. **Name the primitive `Parley`** so "Session" never denotes the #14 concept, and "Negotiation" is left to §13 (above).
2. **Compose with v2.0.3, do not duplicate it.** The Mandate is a §17-family object (same trust chain, DID principal model, alg-whitelist discipline, fail-closed verification — it generalises `authorization_proof`, it does not introduce a parallel identity model). Parley "state" reuses the §4.4 manifest shape and §17.13 disclosure rules; round expectations are §6.5 pending obligations; liveness is §4.4.3 heartbeat. The only genuinely new normative surface is the Mandate primitive, the ephemeral lifecycle, and the bilateral handshake.
3. **The six open questions are ratified as the design baseline** as proposed in the RFC body — immediate hang-up on mandate revocation (Q1), open-with-deadlock on mandate intersection (Q2), advisory-by-default outcomes (Q3), islanded-by-default with optional predecessor (Q4), peer-to-peer (Q5, already D5-resolved), server-authoritative clock (Q6). Two refinements: a *binding* outcome must be witnessed by a per-handler `authorization_proof` (not merely a Mandate flag — that is the line between this and reinventing contracts over HTTP); and Mandate `expires_at` skew **reuses the §17.7 ±5-minute configurable Mandate clock-skew window** — the RFC draft's tighter 30s bound is **not** adopted, for consistency with §17 proof-freshness.
4. **§19–20 and §21 (push delivery) ship together** in `spec/v2.1/` — the Mandate's `escalation_hook` is the push-delivery format, so they are co-designed.

Why not the alternatives: *accept-as-is* knowingly writes an overloaded core noun into normative text; *defer-further* buys nothing (no open question more time would answer, charter decisions locked, zero objections in a third of the window) and is exactly the "Parley becomes a six-month track" failure mode the plan's R3 warns about; *reject* throws away a primitive that generalises an already-normative §17 concept and closes real production pain.

## Final call

This is the convergence comment. The verdict is **ACCEPT-WITH-MODIFICATIONS, with the primitive named `Parley`**. The window closes **2026-05-26 23:59 AEST**. If you have a substantive objection to the verdict above, to the `Parley` name, or to any of the four modifications, **raise it on this issue before then**.

**No further objection by 2026-05-26 means the verdict (ACCEPT-WITH-MODIFICATIONS, with Parley) stands** and is treated as convergence. At that point:

- #14 moves to *accepted — normative text pending*;
- §19–22 normative text is drafted into a **new `spec/v2.1/` directory** (never `spec/v2.0.x/`, never `spec/vX.Y.Z/`) via the coordinated-PR pattern that landed v2.0;
- `spec/v2.0/` stays frozen — v2.1 is carried forward into its own directory, not edited in place.

A clarifying question is not an objection and does not pause the clock — ask freely; the clock only stops for a substantive design objection that needs resolution before normative text can be written.

— Knox / TailorAU
