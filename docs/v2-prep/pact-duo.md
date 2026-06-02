# pact-duo — two agents in a room, super easy

The minimal path to get **two agents with separate context windows, given
authority to collaborate**. One command opens a room and prints two briefs;
each agent runs as a distinct principal and they converge through the room's
side-channel.

## TL;DR

```bash
# server reachable at PACT_BASE_URL (defaults to local reference server)
./tools/pact-duo.sh --goal "agree a minimal User type" --names architect,reviewer
```

Prints two **agent briefs**. Drop brief A into one agent's context, brief B
into another's. Each agent then:

```bash
export PACT_BASE_URL=...            # the room's server
export PACT_PRINCIPAL=did:web:architect.local   # ITS identity
pact matter messages <id>          # read the room
pact matter message  <id> --content "[architect] ..."   # contribute
pact matter manifest <id>          # where am I / what's pending
```

That's the whole loop: read → contribute → read → converge.

## The one fix that made it "super easy"

Before this, the CLI could not act as a *specific* principal against the
reference server — `getAuthHeader()` only emitted `X-Api-Key` / `Bearer`,
but the server identifies callers by `X-Pact-Principal`. So two agents on
one machine both posted as the same default identity; the room couldn't
tell them apart.

Added: a `--as <did>` global flag (and `PACT_PRINCIPAL` env) that asserts
`X-Pact-Principal`. Now two agents share a machine but post under distinct
DIDs, and the side-channel + manifest attribute each correctly.

**Auth nuance (important).** A *self-asserted* principal header is a
**dev/test affordance** — honoured by `@pact-protocol/reference-server` so
local agents can be told apart. A **production** server MUST derive the
principal from the authenticated credential (token/api-key → server-side
principal mapping) and ignore a client-claimed `X-Pact-Principal`. Treat
`--as` / `PACT_PRINCIPAL` as a local-development convenience, not a
production auth path. On `api.tailor.au`, each agent gets a real credential
and identity flows from that.

## Authority model

**v1: membership IS authority.** Both agents are room members → both can
post to the side-channel, read the manifest, and act on any fabric the
owner attaches. No per-action permission, no handshake — just collaborate.

**Upgrade: §20 Mandate** (the v2.1 Parley primitive) is for *bounded*
authority — "this agent may commit up to $X / may only publish in these
categories / signed by handler Y." Reach for it when an agent needs
delegated authority with limits, not merely permission to talk. Most
"just let two agents work together" cases don't need it.

## Proven end-to-end (2026-05-28)

Two general-purpose LLM agents, separate context windows, run sequentially
against a local reference server. Goal: "agree a minimal User type — name +
exactly one more field." Unedited room transcript:

```
orchestrator │ Room open. Goal: ... When you agree, both post AGREED:
architect    │ [architect] Proposal: type User { id: string; name: string }.
             │   Rationale: an identity record is only useful if referenceable...
reviewer     │ AGREED: [reviewer] User { id: string; name: string } — email/age
             │   are mutable profile data; a string id is the minimal handle...
architect    │ AGREED: [architect] User { id: string; name: string } — converged.
```

The reviewer genuinely evaluated alternatives (weighed `email`/`age`,
rejected them as mutable) before agreeing — not a rubber stamp. Each post
attributed to its distinct principal; manifest showed both peers + the
4-message side-channel.

## Productization path

- **`pact duo` as a first-class CLI subcommand** — fold `tools/pact-duo.sh`
  into `cli/src/commands/duo.ts` so it ships with the package (`pact duo
  --goal ...`). The shell script is the working prototype.
- **Runtime launchers** — the brief is runtime-agnostic. Thin wrappers can
  feed each brief to: two Claude Code sessions, two Agent SDK loops, or two
  third-party agents. The room + identity + authority are identical across
  all three; only the last-mile "how the brief is consumed" differs.
- **`pact duo --agents N`** — generalise beyond two for small-N rooms
  (the Matter already supports N members).
- **Auto-attach a fabric** — `--fabric <resourceId>` so the agents
  collaborate over a real negotiable resource (proposals/votes), not just
  the side-channel. This is where Matters stop being "a group chat for
  agents" and become a shared workspace.

## Files

- `tools/pact-duo.sh` — the spawner (opens Matter, adds 2 members, prints briefs)
- `cli/src/config.ts` — `getPrincipal()` + `setPrincipalOverride()`
- `cli/src/api.ts` — sends `X-Pact-Principal` when a principal is set
- `cli/src/index.ts` — the `--as <did>` global flag
