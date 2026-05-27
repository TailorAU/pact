# Matter conformance vectors — v2.2 draft

This directory holds the conformance test vectors for the §24 Matter
primitive. They are **DRAFT** — they will move to
`spec/v2.2/conformance/matters/` when v2.2 is properly opened (gated on
v2.1 ship + maintainer sign-off).

## Vectors in this directory

| File | Asserts |
|---|---|
| `matter-open-success.yaml` | POST /matters creates the Matter, caller becomes owner, `pact.matter.opened` emitted |
| `matter-attach-fabric.yaml` | Attach is a link (fabric NOT modified); `pact.matter.fabric-attached` emitted |
| `matter-message-post.yaml` | Side-channel is typed events; structured body + optional fabric reference |
| `matter-manifest-cross-fabric.yaml` | Cross-fabric obligation aggregation + §17.13 cross-org reduction on counterparties |
| `matter-close-no-cascade.yaml` | Closing a Matter does NOT cascade to attached fabrics (resolves RFC OQ3) |

## Runner kind

These vectors are `kind: http` and run against any PACT server that exposes
the §24 endpoints. The §-text draft (`docs/v2-prep/matters-spec-draft.md`)
proposes a new `kind: matter` for richer multi-step lifecycle vectors
(open → attach → message → manifest → close) analogous to the v2.0.3
`kind: session`. That runner kind lands when the v2.2 carry-forward opens.

## Reference implementation

`reference-server/src/matters.ts` implements every endpoint these vectors
exercise. Verified by the smoke test in `tools/matter-smoke.sh` (drafted
alongside this RFC) — equivalent of the manual `curl` sequence in the
RFC #18 issue body.
