<!--
DRAFT close-out comment for issue #13 (AloomU 8-question v1.1 production feedback).
NOT yet posted. Coordinator: post via
`gh issue comment 13 --repo TailorAU/pact --body-file <this file>`.
§refs verified against spec/v2.0/SPECIFICATION.md at v2.0.3 (CHANGELOG v2.0.3, 2026-05-15).
Disposition source: docs/v2-prep/d1-d6-decisions.yaml (D2=B) + the two existing
maintainer comments on this thread (v2-plan reply + "v2.0 shipped today" reply).
-->

## Close-out: AloomU's 8 v1.1 questions against v2.0 / v2.0.3

Thanks again for the inaugural-production feedback — this was the single most useful input into v2's shape. v2.0 shipped 2026-05-14 (with patch releases through **v2.0.3** on 2026-05-15). Here is the point-by-point disposition, with §references into `spec/v2.0/SPECIFICATION.md`.

### Addressed in v2.0 core — please confirm

| # | Your question | v2.0 resolution | Where |
|---|---|---|---|
| **Q1** | Self-approval — configurable or hard? | An author **cannot** approve their own proposal by default under `single`/`majority`/`unanimous` (approver `agentId` must differ from author). A per-resource `allowSelfApproval` boolean (default `false`) is the explicit opt-out. For your multi-agent-under-one-operator case the **recommended** pattern is the `objection-based` policy — no approval step exists, so the question doesn't arise. The subsection explicitly cites this issue's Q1. | **§5 → "Self-approval"** + the merge-policy table (`objection-based` row) |
| **Q2** | Service-account auth | Formalised as the **BYOK invite-token flow**: `POST /api/pact/{docId}/join-token` issues a scoped, single-use token; the agent joins with no account, receiving a scoped credential. v2.0.3 makes this the inherited auth path for atomic onboarding too. **Partial:** the *lifecycle* endpoints you asked for (rotate / revoke) are scoped to v2.1 §22 (service-account auth track T5) — see note below. | **§4.4.5** (BYOK / `join-token-request.json` union), **§7.1** `join-token`; lifecycle → §22 (v2.1, reserved) |
| **Q6** | Webhook / push out | The pull side is fully covered (event log §6, `GET /events`, real-time channel §7.2, plus v2.0.3 `GET /_status` + `mark-read` for delivery/seen state). **Partial:** signed-webhook **push** delivery is the v2.1 §21 track (T4) — see note. | §6, §7.2, §4.4 (`_status`/`mark-read`); push → §21 (v2.1, reserved) |
| **Q7** | Agent identity persistence + operator transfer | **Fully addressed.** New normative section: cooperative operator transfer (§23.3), hostile / non-cooperative recovery via M-of-N with a time-locked dispute window (§23.4), multi-channel notification + dispute that closes the dispute-window-starvation attack (§23.5b), identity-lifecycle event types (§23.5), conformance (§23.6). This directly answers your operator-of-record-continuity / sovereignty requirement. | **§23 (Agent Identity Lifecycle)**, esp. §23.3, §23.4, §23.5b |
| **Q8** | Open standard + reference impl + conformance | Conformance is now first-class: machine-readable test vectors and runner under **`spec/v2.0/conformance/`** (`@pact-protocol/conformance-runner`), conformance tiers normatively defined (**§15.2** Core/Extended, **§17.9** Authorization-Required), and a behavioural conformance probe **§15.5 `pact_introspect_tier`** so a tier claim can be checked, not just self-asserted. Self-certification + `IMPLEMENTERS.md` follow as implementations come in (see the second-implementation invitation below). | **§15.2**, **§15.5**, **§17.9**, `spec/v2.0/conformance/` |

> **On the two "partial"s (Q2, Q6).** v2.0 deliberately shipped lean (decision D1=A — single v1.1→v2 jump, no interim v1.2-stable). Service-account *lifecycle* (rotate/revoke, §22) and *push* delivery (signed webhooks, §21) are scoped, RFC-tracked v2.1 work, not dropped: §19–22 are explicitly reserved in v2.0 and tracked as T4/T5 in `docs/v2-plan.yaml`. The v2.0 mechanisms above are forward-compatible with them. If your unrealestate.au deployment needs rotate/revoke or push *before* v2.1, say so here and we'll prioritise the v2.1 track accordingly — production demand moves the queue.

### Out of PACT core — by decision, not omission (Q3–Q5)

Q3 (attached-document share visibility), Q4 (`--section` targeting attached docs), and Q5 (`--weight` / `--type` semantics) are **intentionally not in PACT v2.0 core**. Per recorded decision **D2 = B** (`docs/v2-prep/d1-d6-decisions.yaml`): the attached-resource weighting/type/composition model stays a **Tailor extension spec**, not a PACT core primitive — PACT core stays focused on consensus primitives, and document-composition semantics are domain-specific enough that baking them into the neutral protocol would expand the surface every non-Tailor implementation must carry.

This means Q3–Q5 are answered for Tailor deployments via the Tailor extension, and the PACT spec will not address them. If AloomU needs equivalent attached-resource semantics in your own stack, the right path is either (a) adopt the Tailor extension, or (b) raise a *new* issue proposing a generic PACT-core composition primitive with the cross-implementation use-case — but note D2=B was decided precisely to avoid premature generalisation, so that would need a strong multi-implementation motivation.

### Ask: confirm so we can close

If the v2.0 / v2.0.3 dispositions above match your understanding — and you're content with Q2/Q6 lifecycle/push being v2.1-tracked and Q3–Q5 being out-of-core by D2=B — please drop a confirming comment and we'll close #13. If anything is off against your live unrealestate.au deployment, comment here and we'll triage as a v2.0.x patch or a v2.1 input.

### Invitation: AloomU as the second independent PACT implementation

A standing offer, framed as an invitation, not a dependency on closing this issue.

PACT's whole thesis is that it is a **neutral protocol**, not "Tailor's API with a spec wrapped around it." That thesis only becomes *demonstrably* true when there are **two independent implementations interoperating over a shared fabric** — one of them not built by Tailor. AloomU is already the protocol's first real production consumer (unrealestate.au, Stage-0), you filed the eight questions that shaped v2, and §15 now gives you a conformance suite to validate against.

So: would AloomU be willing to stand up an **independent PACT implementation** and be listed as the **second conformant implementer** in `IMPLEMENTERS.md`? Concretely, that could be incremental:

- Start at **Core conformance** (§15.2) against the `spec/v2.0/conformance/` vectors — no information-barrier / mediation burden.
- Run the §15.5 `pact_introspect_tier` probe so the conformance claim is independently checkable.
- Demonstrate a single cross-implementation negotiation: an AloomU-hosted agent and a Tailor-hosted agent on one fabric, exchanging proposals/constraints through v2.0.3 `_onboard` + the event log.

That single interop demo is the artifact that makes the neutral-protocol claim real for grant assessors, federal prospects, and the wider ecosystem — and it directly answers your own Q8 ("is this an open standard or one vendor's API?"). No timeline pressure and no obligation; even a "yes in principle, not yet" lets us reserve the `IMPLEMENTERS.md` slot and design the interop vectors with your stack in mind. If it's of interest, reply here or open a tracking issue and we'll scope it together.

— Knox / TailorAU (draft for review before posting)
