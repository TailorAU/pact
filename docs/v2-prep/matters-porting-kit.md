# Matter primitive — implementer porting kit

> **Audience:** Anyone implementing the §24 Matter primitive on a production
> PACT server (Tailor monorepo, AloomU, third parties). The reference server
> at `reference-server/` is the second independent implementation; your
> implementation is the third+.
>
> **Status of the spec:** §24 is DRAFT — `docs/v2-prep/matters-spec-draft.md`.
> Promotes to `spec/v2.2/SPECIFICATION.md` post v2.1 ship + maintainer
> sign-off via `tools/promote-matters-to-v2.2.ps1`. Implementers can
> start NOW against the draft; the §-text won't change shape between
> draft and promotion (only DRAFT front-matter is stripped + `2.2-draft`
> → `2.2`).
>
> **Surface to implement:** 10 REST endpoints + 6 event types + cross-fabric
> manifest aggregation. ~470 lines in the reference impl.

## TL;DR — what you need to ship

1. Add `Matter` storage alongside your existing fabric storage. A Matter is NOT a fabric — it's a peer-container above fabrics. Same `principal_id` / `agentId` identity primitives; new container concept.

2. Implement these 10 endpoints (signatures + payload shapes match `docs/v2-prep/matters-schemas/`):

   | Method | Path | Schema |
   |---|---|---|
   | POST | `/api/pact/matters` | `matter-create-request.json` / `matter-create-response.json` |
   | GET | `/api/pact/matters` | (additive — implementations MAY require auth scoping) |
   | GET | `/api/pact/matters/{id}` | (returns Matter object) |
   | POST | `/api/pact/matters/{id}/members` | `matter-add-member-request.json` |
   | POST | `/api/pact/matters/{id}/fabrics` | `matter-attach-fabric-request.json` |
   | DELETE | `/api/pact/matters/{id}/fabrics/{resourceId}` | (no body) |
   | POST | `/api/pact/matters/{id}/messages` | `matter-message-request.json` |
   | GET | `/api/pact/matters/{id}/messages` | (returns array of `matter-message.json`) |
   | GET | `/api/pact/matters/{id}/manifest` | `matter-manifest-response.json` |
   | POST | `/api/pact/matters/{id}/close` | `matter-close-request.json` |

3. Emit these 6 event types on the Matter's own event-log domain:
   - `pact.matter.opened`
   - `pact.matter.member-added`
   - `pact.matter.fabric-attached`
   - `pact.matter.fabric-detached`
   - `pact.matter.message`
   - `pact.matter.closed`

4. Pass `tools/matter-smoke.sh` against your server (20/20 assertions). Pass the 5 conformance vectors under `docs/v2-prep/matters-vectors/` (`kind: http`).

5. Advertise support: add `capabilities.matters: true` to your §15.1 Implementation Profile (mirrors `capabilities.atomicOnboard` from v2.0.3).

## Reuse — what NOT to reinvent

These come from shipped surface; don't roll your own:

- **Identity** — `§17` `HumanPrincipal` + `§23` `agentId`. Matter members carry the same DIDs you already accept on fabric operations.
- **Cross-org boundary** — `§15.4` registrable-domain (eTLD+1) rule. Use your existing implementation. Reference: `reference-server/src/disclosure.ts:registrableDomain`.
- **Disclosure reduction** — `§17.13` cross-org peer reduction. Apply to the `counterparties` array in the Matter manifest the same way you apply it to the §4.4.2 fabric manifest. Reference: `reference-server/src/disclosure.ts:reducePeerForManifest` — adapt for the Matter peer shape (`role` is `owner|participant`, no `constraints` array).
- **Event hash-chaining** — `§6.4`. The reference impl currently uses monotonic sequence numbers per fabric/Matter; production implementations using the §6.4 signed-root chain should extend it to cover the Matter event log identically.
- **Authorization-Required tier** — `§17.6` proof verification. Cross-org member adds (`POST /matters/{id}/members` where the added principal is on a different eTLD+1 from the caller) MUST require valid §17.6 `authorization_proof` at this tier. Reuse your existing proof verification.

## The load-bearing feature: cross-fabric manifest aggregation

`GET /api/pact/matters/{id}/manifest` is where Matters earn their keep. For each attached fabric:

1. Look up the fabric in your existing fabric store
2. Enumerate the caller's pending §6.5 obligations where `principal_id == caller`
3. Aggregate across all attached fabrics into `pending_obligations_across_fabrics[]`

This is the "where am I and what do I owe across this engagement" answer that fabric-scoped §4.4.2 cannot produce. If your implementation skips this, Matters degrade to "a list of fabric IDs."

Reference: `reference-server/src/matters.ts:handleMatterManifest`.

## Disclosure boundaries — read this carefully

The side-channel (`pact.matter.message` events) has DIFFERENT disclosure rules from fabric content:

- **Fabric content** (§4.4.2 manifest): cross-org peers see PII-elided counterparty records. Constraint text is reduced to counts.
- **Side-channel content**: Matter members see EVERY message in full, regardless of org. The cross-org boundary is enforced at *membership* (§17 proof to join), not at *content* (because the side-channel exists precisely to enable cross-org coordination).

If you apply §17.13 reduction to side-channel message bodies, you've broken the primitive. The reference impl does not — see `handleListMessages` in `matters.ts`.

## Lifecycle rules

- **`phase: open` → `active`**: implementation-defined; reference impl doesn't auto-transition (Matter stays `open` until close). You MAY auto-transition to `active` on first member-add or first fabric-attach.
- **`phase: closed`**: rejects all mutations (`POST /members`, `/fabrics`, `/messages`, `/close`) with `409`. GET endpoints continue to work.
- **Closure does NOT cascade to attached fabrics.** Fabrics outlive Matters; closing a Matter detaches and records the resourceIds as audit trail (`detached_fabrics` array on `pact.matter.closed`), but fabric state is untouched. Vector `matter-close-no-cascade.yaml` guards.
- **`opened_by` is the first member with role=`owner`**. Subsequent owners can be added via `POST /members` with `role: owner`. Only owners can: add/remove members, attach/detach fabrics, close the Matter.

## Multi-Matter membership of one fabric

A fabric MAY be attached to multiple Matters (RFC OQ1, lean adopted). When a caller queries a Matter's manifest, the attached fabrics' `caller_is_fabric_member` flag indicates whether they have separately joined the fabric. This is "eligibility, not enrollment" (RFC OQ2): Matter membership does NOT auto-join the caller to attached fabrics. They invoke §4.4.5 `_onboard` per fabric as usual.

## Acceptance criteria

Your implementation is considered Matter-conformant when:

1. **Smoke test passes**: `tools/matter-smoke.sh <port>` against your server returns `PASS: 20 FAIL: 0`.
2. **Conformance vectors pass**: 5 vectors under `docs/v2-prep/matters-vectors/` (post-promotion: `spec/v2.2/conformance/matters/`) all execute green via `spec/v*/conformance/runner` (or your equivalent).
3. **Implementation Profile** advertises `capabilities.matters: true` at `/.well-known/pact.json`.
4. **Cross-org disclosure** reduces `counterparties` in the manifest per §17.13 (cross-org peers carry `cross_org: true` and `org_eTLD_plus_1` is omitted).
5. **Closure non-cascade**: closing a Matter does NOT mutate attached fabrics' state. The `matter-close-no-cascade.yaml` vector explicitly guards this.

## Conformance tier semantics

- **Core**: Matters OPTIONAL. A Core-only impl MAY omit Matter endpoints entirely.
- **Extended**: SHOULD support Matters. If advertised in the Implementation Profile, MUST enforce §17.13 reduction on counterparties.
- **Authorization-Required**: cross-organisation member adds MUST carry a valid §17.6 `authorization_proof`. Reject with `401 unauthorized` or `403 forbidden` if missing/invalid.

## Known gaps (DEFERRED, not blockers)

The reference impl explicitly defers these — you can match the deferral or implement ahead:

- **Matter-wide Mediator** (RFC OQ4). v2.2 keeps Mediators per-fabric. A Matter-scoped Mediator role would let one Mediator span all attached fabrics; deferred to v2.3+.
- **Nested Matters** (RFC OQ5). Single level of grouping for v2.2; nesting deferred.
- **Hash-chained Matter event log** (§6.4 extension). Reference impl uses monotonic sequence per Matter; production impls using §6.4 signed-root chains should extend identically.
- **`body.format` other than `"text"`** in side-channel messages. The schema reserves the field for `proposal-ref`, `obligation-ref`, etc.; v2.2 ships `text` only.

## Phased adoption suggestion

If shipping the full surface in one go is too big:

| Phase | Surface | Why |
|---|---|---|
| 1 | POST /matters, GET /matters, GET /matters/{id} | Stand up the storage + read; nothing else depends on it |
| 2 | POST /members, POST /fabrics, DELETE /fabrics | Members + attachments — enables manifest queries to be meaningful |
| 3 | GET /manifest | The load-bearing feature; tests cross-fabric aggregation |
| 4 | POST /messages, GET /messages | Side-channel |
| 5 | POST /close | Lifecycle terminal state |

Smoke test passes only when all 5 phases are implemented; vectors can be run incrementally.

## Reference implementation file map

| File | What |
|---|---|
| `reference-server/src/store.ts` | `Matter`, `MatterMember`, `MatterFabricAttachment`, `MatterMessage` types + `createMatter` / `getMatter` / `emitMatter` |
| `reference-server/src/matters.ts` | 10 route handlers + `routeMatters` dispatcher |
| `reference-server/src/server.ts` | Dispatch wiring (lines ~735-748) — Matter routes checked BEFORE fabric routes so `/api/pact/matters` is not interpreted as a fabricId |
| `reference-server/src/disclosure.ts` | `isCrossOrg`, `registrableDomain` (reused from §4.4 work) |
| `tools/matter-smoke.sh` | 20-assertion smoke test you can run against any Matter-implementing server |

## Questions, bug reports, design pushback

File on TailorAU/pact with label `matters`. Reference issue #18 (the RFC).
