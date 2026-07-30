# PACT v2.1 Conformance — DRAFT

> Part of the `spec/v2.1/` DRAFT directory — NOT FOR CITATION until signed
> off (see [`../README.md`](../README.md)).

Test vectors for the PACT v2.1 conformance suite: the v2.0 suite carried
forward, plus the `kind: mandate` family for §20.

## Vector kinds (`test-vector-format.yaml`, format version "2")

| Kind | Exercises | Executed by the reference runner? |
|---|---|---|
| `http` (default) | One HTTP request/response + expected events | Yes, with `--server` (skips without) |
| `session` | Sequenced HTTP steps with cross-call assertions (v2.0.3 §4.4) | Yes, with `--server` |
| `verification` | §17.7 authorization-proof verification, client-side | Yes, always |
| `mandate` (v2.1) | §20 Mandate verification/enforcement at a guarded boundary | **No — skipped** with a stated reason; the `@pact-protocol/mcp` test suites (`mcp/test/mandate.test.mjs`, `mcp/test/wire.test.mjs`) are the current executable enforcement |

## Layout

```
conformance/
├── README.md                    ← this file
├── test-vector-format.yaml      ← format v2 (adds kind: mandate, notes:)
├── core/                        ← core-level vectors (join, …)
├── extended/
│   ├── attestation/             ← §17/§18 proof-verification vectors
│   ├── sessions/                ← §4.4 fabric/session-AWARENESS vectors
│   │                              (NOT Parleys — see the §19.1 naming note)
│   └── mandate-mcp/             ← 12 kind: mandate vectors (§20, v2.1)
└── runner/                      ← @pact-protocol/conformance-runner
```

The `extended/sessions/` name predates the Parley rename and refers to
v2.0.3 **session awareness** (§4.4) — client work-sessions against a fabric.
Parley (§19) vectors are the `extended/mandate-mcp/` family and future
`extended/parleys/` HTTP vectors, which land when the reference server
implements §19.

## Running

```
cd runner
npm install && npm run build
node dist/index.js run --vectors ..                 # verification vectors only
node dist/index.js run --vectors .. --server URL    # + http/session vectors
```

`kind: mandate` vectors report SKIP with a reason; treating that as green
would be silent truncation — the table above is the disclosure.
