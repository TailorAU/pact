# PACT v1.1 — errata

> Errata for the frozen v1.1 specification. This file is **additive** — it documents known issues in [`SPECIFICATION.md`](./SPECIFICATION.md) and its schemas without amending them. Per [AGENTS.md](../../AGENTS.md) rule 4, `spec/v1.1/SPECIFICATION.md` and `spec/v1.1/schemas/` stay frozen for citation stability; this note is the canonical disclosure for v1.1 readers.
>
> Public closure record: [TailorAU/pact#15](https://github.com/TailorAU/pact/issues/15).

## E1 — Phantom section references in the preamble

**Location:** [`SPECIFICATION.md`](./SPECIFICATION.md), lines 14–16 ("What's New in v1.1").

The preamble references:

- *"Resource Types (Section 15)"*
- *"Implementation Profiles (Section 16)"*
- *"Conformance Levels (Section 16)"*

These sections do not exist in `spec/v1.1/SPECIFICATION.md`, which ends at §14 (Open Questions). The intended content lives in the v2.0 draft as §14 and §15.

**Reader guidance.** For Resource Types, Implementation Profiles, and Conformance Levels, see:

- [`../v2.0/SPECIFICATION.md` §14](../v2.0/SPECIFICATION.md) — Resource Types
- [`../v2.0/SPECIFICATION.md` §15](../v2.0/SPECIFICATION.md) — Implementation Profiles and Conformance

(`spec/v2.0/` was created on 2026-05-13 by collapsing the canonical v1.2-draft per decision D1.)

## E2 — Schema `$id` paths point to `/v0.4/`

**Location:** All files in [`schemas/`](./schemas/).

Every schema in `spec/v1.1/schemas/` carries a `$id` of the form:

```
https://pact-spec.dev/schemas/v0.4/{name}.json
```

These should reference `v1.1`, not `v0.4`. The `$id` was carried forward unchanged across the v0.4 → v1.0 → v1.1 promotions.

**Reader guidance.** Treat the `$id` as a stable URI for the schema content; its path component does not reflect the spec version the schema belongs to. The schemas in `spec/v1.1/schemas/` ARE the v1.1 schemas regardless of `$id` path.

**Upstream fix:** `spec/v2.0/schemas/*.json` use `$id` paths matching their version directory (`https://pact-spec.dev/schemas/v2.0/...`). The v1.1 schemas remain as-is for citation stability per AGENTS.md rule 4.

---

*Last updated: 2026-05-13.*
