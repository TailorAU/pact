<!--
DRAFT close-out comment for issue #12. NOT yet posted.
Coordinator: post via `gh issue comment 12 --repo TailorAU/pact --body-file <this file>`
after Knox decides the open question flagged at the end.
Assessed against spec/v2.0/SPECIFICATION.md at v2.0.3 (CHANGELOG v2.0.3, 2026-05-15).
-->

## Triage: #12 against the current spec (v2.0.3)

Triaged against `spec/v2.0/SPECIFICATION.md` as of **v2.0.3** (the current stable; v1.2-draft was collapsed into v2.0 on 2026-05-13 per `docs/v2-prep/d1-d6-decisions.yaml` D1=A, so this issue is now read against v2.0, not v1.2).

This issue conflates two layers that v2.0.3 now separates cleanly. The honest answer is **"partly resolved, with one precisely-scoped residual gap"** — not a clean close. Detail below.

### What v2.0.3 *does* resolve: opening the coordination envelope

The original issue's "Why this matters" is: *"a CLI/SDK can't drive a negotiation from outside the implementation — it has to wait for the Mediator to auto-open."* The part of that which is about **entering a resource and declaring your negotiating envelope up front** is now fully covered:

- **§4.4.5 `POST /api/pact/{fabricId}/_onboard`** — the atomic join+constrain operation added in v2.0.3. A caller deliberately, from outside the implementation, opens its participation in a coordination context (fabric) *with constraints declared in the same transaction* — "open a negotiation with constraints declared up front." Either the join + all constraints commit, or nothing does (§4.4.5 atomicity contract, steps 1–5). Emits one `pact.fabric.onboarded` event.
- **§4.1 `agent.join` / §7.1 `POST /api/pact/{documentId}/join`** — the long-standing canonical operation to enter a resource when constraints are not known up front (§15.6 "When to use legacy join").
- **§15.6 Fabric Onboarding Pattern** — documents the end-to-end caller-initiated flow: initiator opens the fabric (step 1), invitee `POST /_onboard`s into it (step 4), "B's manifest now reflects the negotiation envelope" (step 6), "substantive messages may now flow" (step 7). This is exactly the portable, implementation-independent "open from outside" path the issue asked for.
- **§6.5 Pending Obligations** + **§4.4.1/§4.4.2 `_status` / `manifest`** — make "what is expected of whom next" a first-class, queryable concept rather than the implementation-specific inference the issue complained about. A driving CLI/SDK no longer has to reverse-engineer fabric state.

For the **portability concern** the issue raises ("not portable across PACT servers"), §4.4 + §15.6 + §6.5 close it: a non-Tailor client can now open a fabric, declare its envelope atomically, and read obligation state through documented, schema-backed, conformance-tiered operations.

### The residual gap: opening a §13.5.3 *negotiation round* is still not a caller-initiated operation

The issue's literal `## Acceptance` criteria are scoped to **§13.5.3 Negotiation Rounds** and **§7 / §13.6 API surface** — the *mediated multi-round exchange on a contested section*, not fabric entry. On that narrow reading, v2.0.3 does **not** resolve the issue, and I want to be precise rather than rubber-stamp:

- **§13.5.3 (current v2.0.3 text):** `negotiation.open` is still listed as *"Mediator opens a negotiation on a section (triggered by conflicting intents or proposals)"* — Mediator-auto-triggered only. There is still no documented operation, payload, or caller for a deliberate "please open a negotiation on §X" request.
- **§13.6 Mediator API Endpoints (current v2.0.3 text):** still exactly the three endpoints the issue flagged — `GET /negotiations`, `POST /negotiations/{id}/position`, `GET /negotiations/{id}/synthesis`. No `POST /negotiations`.
- **§16 Open Question 8** ("How does the Mediator handle agent liveness during negotiation?") confirms the negotiation-round lifecycle is still treated as Mediator-driven, not caller-driven.

`_onboard` does **not** cover this. Onboarding establishes the *fabric envelope before any substantive message* (§4.4.5: "This is the operation that establishes the negotiation envelope *before* any substantive message"). The §13.5.3 negotiation round is a substantive mediated primitive that happens *inside* an already-open fabric, typically in response to a conflict. They are different layers; one does not subsume the other.

The closest forward-looking answer is **out of v2.0 core**: ephemeral caller-initiated negotiation is the v2.1 **Negotiation Session** work (RFC [#14](https://github.com/TailorAU/pact/issues/14)), whose draft *does* introduce a deliberate caller-opened operation (`POST /api/pact/sessions`, see `docs/v2-prep/rfc-sessions-mandate.md`). §19–20 are reserved in v2.0 for exactly this. (Naming note: the RFC #14 shepherd synthesis renames the bare "Session" to **"Negotiation Session"** to avoid collision with the shipped v2.0.3 §4.4 fabric *session-awareness* layer; the final noun is pending the maintainer's SOQ1 call on #14 — recommended "Negotiation Session".) That layer is the right home for "two agents deliberately open a bounded negotiation" — but it is v2.1, not a v2.0.3 resolution, so it cannot be claimed as closing #12 today.

### Recommended disposition (needs maintainer call)

I am **not** closing this as "resolved by v2.0.3" because that would overstate it. Two clean options for the maintainer:

1. **Close as resolved-by-design, re-scoped.** Accept that #12's underlying need — "a portable, caller-initiated, implementation-independent way to enter a negotiation context with your envelope declared up front" — is met by §4.4.5 `_onboard` + §15.6 + §6.5, and that deliberate *mediated-round* opening is intentionally deferred to the v2.1 Negotiation Session (#14). Update §13.5.3 / §13.6 with a one-line forward-reference ("deliberate negotiation opening: see Negotiation Session, §19–20 / RFC #14") via the normal reviewed-change path with maintainer sign-off, then mirrored out via `tools/mirror-spec.ps1` (AGENTS.md rule #5), then close #12 pointing at #14 for the residual.
2. **Keep #12 open, re-labelled and re-scoped to the narrow gap.** Trim the issue to just the §13.5.3/§13.6 "no caller-initiated `negotiation.open`" item, drop the `cli` acceptance bullet (the fabric-entry CLI surface — `pact onboard` — already shipped in v2.0.3), and fold the remaining design choice (auto-open vs explicit-open `POST /negotiations` vs Sessions-only) into the #14 Sessions RFC so it is decided once.

My recommendation: **option 1**, on the grounds that the v2.1 Negotiation Session is the deliberate-negotiation primitive and a second parallel `POST /negotiations` design (issue Option 1/3) would be redundant surface. But the auto-open-vs-explicit-open design choice is genuinely the maintainer's to call — that is why this issue carried the `rfc` label, and I will not pre-empt it.

— triage bot (draft for Knox / TailorAU review before posting)
