#!/usr/bin/env bash
# pact-duo — the "super easy" way to get two agents into one room with
# separate context windows and authority to collaborate.
#
# Opens a Matter, adds two agent members, and prints two self-contained
# BRIEFS. Drop brief A into one agent's context and brief B into another's.
# Each agent then participates as a DISTINCT principal via the PACT CLI's
# `--as` flag (or the PACT_PRINCIPAL env var) — so the room can tell them
# apart and the side-channel + manifest attribute each post correctly.
#
# Authority model (v1): membership IS authority. Both agents are members,
# so both can post to the side-channel, read the manifest, and act on any
# fabric the owner attaches. Bounded authority ("may commit up to $X") is
# the §20 Mandate upgrade — not needed just to let two agents collaborate.
#
# Usage:
#   ./tools/pact-duo.sh --goal "agree the User type: name + one field"
#   ./tools/pact-duo.sh --goal "..." --names architect,reviewer
#   PACT_BASE_URL=https://api.tailor.au ./tools/pact-duo.sh --goal "..."
#
# Requires: the CLI built (cd cli && npm run build) and a PACT server
# reachable at PACT_BASE_URL (defaults to the local reference server).

set -euo pipefail

GOAL=""
NAMES="agent-a,agent-b"
OWNER="did:web:orchestrator.local"
BASE_URL="${PACT_BASE_URL:-http://127.0.0.1:4100}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACT="node ${ROOT}/cli/dist/index.js"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --goal)     GOAL="$2"; shift 2 ;;
    --names)    NAMES="$2"; shift 2 ;;
    --owner)    OWNER="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$GOAL" ]]; then
  echo "error: --goal is required" >&2
  exit 2
fi

export PACT_BASE_URL="$BASE_URL"

IFS=',' read -r NAME_A NAME_B <<< "$NAMES"
PRINCIPAL_A="did:web:${NAME_A}.local"
PRINCIPAL_B="did:web:${NAME_B}.local"

echo "Opening room on ${BASE_URL} ..." >&2

# 1. Owner opens the Matter.
OPEN_JSON=$($PACT --as "$OWNER" matter open \
  --name "duo: ${GOAL}" --display-name "orchestrator" --json)
MATTER_ID=$(echo "$OPEN_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['matter_id'])")

# 2. Owner adds both agents as members (participant role = post + read).
$PACT --as "$OWNER" matter add-member "$MATTER_ID" \
  --principal "$PRINCIPAL_A" --display "$NAME_A" --role participant >/dev/null
$PACT --as "$OWNER" matter add-member "$MATTER_ID" \
  --principal "$PRINCIPAL_B" --display "$NAME_B" --role participant >/dev/null

# 3. Owner posts the opening message so both agents see the goal on first read.
$PACT --as "$OWNER" matter message "$MATTER_ID" \
  --content "Room open. Goal: ${GOAL}. Two agents (${NAME_A}, ${NAME_B}) — collaborate via this side-channel. Post your reasoning, read each other, converge. When you agree, both post a line starting with AGREED: summarising the shared outcome." >/dev/null

echo "Room ready: ${MATTER_ID}" >&2
echo >&2

emit_brief() {
  local name="$1" principal="$2" peer="$3"
  cat <<BRIEF
─────────────────────────────────────────────────────────────────────
 AGENT BRIEF — ${name}
─────────────────────────────────────────────────────────────────────
You are "${name}", collaborating with "${peer}" in a shared PACT room
(a Matter). You each have your own context window; the room is how you
coordinate. You act as principal ${principal}.

GOAL: ${GOAL}

Setup (run once):
  export PACT_BASE_URL="${BASE_URL}"
  export PACT_PRINCIPAL="${principal}"     # posts under your identity

Your three verbs:
  # read everything said so far (do this FIRST and between every turn):
  pact matter messages ${MATTER_ID}

  # where am I / what's pending across the room:
  pact matter manifest ${MATTER_ID}

  # say something (prefix with your name so turns are legible):
  pact matter message ${MATTER_ID} --content "[${name}] <your message>"

Protocol:
  1. Read the side-channel (pact matter messages).
  2. If you have something to add or a counter-proposal, post it.
  3. Read again to see ${peer}'s response.
  4. Repeat until you both agree.
  5. When agreed, post: --content "AGREED: <one-line shared outcome>"
     Then stop.

Authority: you are a room member — that IS your authority to post and to
act on any resource the owner attaches. You do NOT need permission for
each message; just collaborate. Do not close the room (owner-only).
─────────────────────────────────────────────────────────────────────
BRIEF
}

emit_brief "$NAME_A" "$PRINCIPAL_A" "$NAME_B"
echo
emit_brief "$NAME_B" "$PRINCIPAL_B" "$NAME_A"

cat <<FOOTER

Watch the conversation live:
  PACT_BASE_URL="${BASE_URL}" pact matter messages ${MATTER_ID}

MATTER_ID=${MATTER_ID}
FOOTER
