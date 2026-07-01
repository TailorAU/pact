# Rehoming: the PACT knowledge graph moves in

**Status:** in progress — tracked at [TailorAU/tailor-app#3690](https://github.com/TailorAU/tailor-app/issues/3690).
**Decisions locked 2026-07-01 (filer sign-off).**

## What is happening

The verified-knowledge-graph product formerly branded **Source**
(`source.tailor.au` — AU legislation, the Axiom facts API, topic/scenario
consensus, the MCP + Python + OpenAPI agent surfaces) is being rehomed into
this repository under the PACT brand, and served at **pact.tailor.au**
(already live, dual-serving with `source.tailor.au` until the DNS cutover).
The product was literally once `sites/pact/` before it was renamed Source;
this move reverses that rename. History arrives via a history-preserving
`git filter-repo` extraction with a full secret scrub + rotation gate — it
lands on a review branch, never directly on `main`.

## Positioning (locked)

**PACT stands on its own.** It is independent infrastructure — a public
**source of truth** plus a **protocol for reaching consensus** — owned by no
single vendor. **Tailor is a consumer, not the owner:** it uses PACT for
(1) sourcing verified public information and (2) the consensus/collaboration
mechanism. License: **MIT** (this repo's existing license and spec licensing
are unchanged; the incoming product code is MIT).

## Naming governance — the three PACTs

| Name | What it is | Where |
|---|---|---|
| **The PACT protocol** | The vendor-neutral spec anyone can implement | `spec/` in this repo + `@pact-protocol/cli` / `@pact-protocol/mcp` |
| **Tailor's in-app PACT implementation** | Tailor's document-collaboration implementation of the protocol | `TailorAU/tailor-app` (`src/WebApi` `Features/Pact/` etc.) — stays there; **not** this product |
| **PACT, the knowledge graph** | The independent verified-knowledge product (formerly Source) — this rehome | This repo (incoming) · `pact.tailor.au` |

Writers: never call the knowledge graph "PACT Hub" or "a Tailor product
module"; never conflate the protocol spec with either implementation. The
spec remains clearly demarcated and openly licensed inside this repo.

## What stays vendor-neutral

`@pact-protocol/cli` and `@pact-protocol/mcp` remain vendor-neutral
coordination tooling that works against **any** PACT-compliant server. The
knowledge-graph product is one conforming implementation (resource type
`fact`) — see its `PACT_CONFORMANCE.md` once the code lands.

## Epistemic model

The product arrives carrying the two-axis epistemic reshape
([tailor-app#3691](https://github.com/TailorAU/tailor-app/issues/3691)):
four unordered warrant kinds; consensus state + credence (asymptotically
< 1.0, always) + convention-stop flags; no privileged axiom floor; typed,
defeasible challenges on every node — *nullius in verba* · *pacta sunt
servanda*.
