/**
 * MEGA-74 substrate placeholder (#1314). Source response envelope.
 *
 * Every `NextResponse.json(...)` call (REST API routes) and every MCP
 * tool return SHOULD wrap its payload with {@link wrap} so the response
 * shape carries the three MEGA-74 placeholder fields:
 *
 * - `attestation_ref` — see `src/WebApi/Common/Domain/Stitches/AttestationRef.cs`
 * - `actor_kind` — see `src/WebApi/Common/Domain/Stitches/ActorKind.cs`
 * - `actor_org_context` — see `src/WebApi/Common/Domain/Stitches/ActorOrgContext.cs`
 *
 * Phase 1+2 default all three to `null` (= Unattested / unknown actor /
 * OriginatingOrgOnly). Phase 2A Chapters 4 + 6 + Phase 3 chapters 12-15
 * populate them as part of the cross-Fabric attestation work.
 *
 * NO LOGIC — shape only. Wrapping at the response boundary reserves the
 * field surface so downstream consumers (PACT MCP, Tailor MCP, OpenAPI
 * agents) can rely on a stable shape across phases.
 *
 * **Per-route wrap application is incremental** — not every route needs
 * to be wrapped in #1314 R5a. The module ships first; routes adopt it as
 * they're touched. OpenAPI schema is updated alongside the wraps.
 */
export interface SourceResponseEnvelope<T> {
    data: T;
    attestation_ref: null;
    actor_kind: null;
    actor_org_context: null;
}

/**
 * Wrap a payload in the canonical Source response envelope.
 * Phase 1+2 default — all three substrate fields are `null`.
 */
export function wrap<T>(data: T): SourceResponseEnvelope<T> {
    return {
        data,
        attestation_ref: null,
        actor_kind: null,
        actor_org_context: null,
    };
}
