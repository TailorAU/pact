#!/usr/bin/env bash
# Matter primitive end-to-end smoke test against the reference server.
# Exercises every §24 endpoint and prints PASS/FAIL per step. Exit code 0
# iff every assertion passes.
#
# Usage:
#   ./tools/matter-smoke.sh [PORT]   # default port 4100
#
# Requires: the reference server already built (cd reference-server && npm
# run build) — the script starts and stops the server itself.

set -euo pipefail

PORT="${1:-4100}"
BASE="http://127.0.0.1:${PORT}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PID=""
PASS=0
FAIL=0

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

assert() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS  $label"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $label"
    echo "         expected: $expected"
    echo "         actual:   $actual"
    FAIL=$((FAIL+1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  PASS  $label"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $label"
    echo "         needle:   $needle"
    echo "         haystack: $haystack"
    FAIL=$((FAIL+1))
  fi
}

jq_get() {
  python3 -c "import sys,json;v=json.load(sys.stdin)
for k in '$1'.split('.'):
  v=v[int(k)] if k.isdigit() else v[k]
print(v)"
}

# ── start reference server ────────────────────────────────────────────────
echo "Starting reference server on port ${PORT}..."
node "${ROOT}/reference-server/dist/server.js" --port "${PORT}" > /tmp/pact-matter-smoke.log 2>&1 &
SERVER_PID=$!
sleep 1
if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
  echo "Server failed to start. Log:"
  cat /tmp/pact-matter-smoke.log
  exit 1
fi
echo "  PID ${SERVER_PID}, log /tmp/pact-matter-smoke.log"

# ── 1. open Matter ────────────────────────────────────────────────────────
echo ""
echo "1. POST /api/pact/matters — open Matter"
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"name": "Smoke Test Matter", "opened_by_display": "Knox"}')
MID=$(echo "$RESP" | jq_get matter_id)
assert "matter_id minted" "true" "$([[ "$MID" == mtr_* ]] && echo true || echo false)"
assert "phase=open" "open" "$(echo "$RESP" | jq_get phase)"
assert "caller is owner" "owner" "$(echo "$RESP" | jq_get members.0.role)"
assert_contains "pact.matter.opened event id" "evt_" "$(echo "$RESP" | jq_get opened_event_id)"

# ── 2. add cross-org participant ──────────────────────────────────────────
echo ""
echo "2. POST /matters/{id}/members — add cross-org participant"
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/members" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"principal_id": "did:web:counterparty.example", "display_name": "Counterparty", "role": "participant"}')
assert "added=true" "True" "$(echo "$RESP" | jq_get added)"
assert "principalId echoed flat" "did:web:counterparty.example" "$(echo "$RESP" | jq_get principalId)"
assert "role=participant (flat, no member wrapper)" "participant" "$(echo "$RESP" | jq_get role)"

# ── 2b. add-member idempotency (§24.6, RFC #32) ──────────────────────────
# Guards the contract that had no test and therefore drifted: a duplicate add
# must be a safe no-op, not an error, and must never change an existing role.
echo ""
echo "2b. POST /matters/{id}/members — idempotent repeat + different-role no-op"

# Identical repeat → added:false, no error. This is the dropped-ACK retry case.
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/members" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"principal_id": "did:web:counterparty.example", "display_name": "Counterparty", "role": "participant"}')
assert "duplicate add → added=false" "False" "$(echo "$RESP" | jq_get added)"
assert "duplicate add → role unchanged" "participant" "$(echo "$RESP" | jq_get role)"

# Same principal, DIFFERENT role → no-op, existing role retained (option (a)).
# A retry must never be able to promote or demote a member as a side effect.
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/members" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"principal_id": "did:web:counterparty.example", "role": "owner"}')
assert "different-role add → added=false" "False" "$(echo "$RESP" | jq_get added)"
assert "different-role add → EXISTING role retained" "participant" "$(echo "$RESP" | jq_get role)"

# display_name omitted → must default to principal_id, not 400 (the #30 defect).
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/pact/matters/${MID}/members" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"principal_id": "did:web:newmember.example"}')
assert "add without display_name → 200 (not 400)" "200" "$STATUS"

# ── 3. attach two fabrics ─────────────────────────────────────────────────
echo ""
echo "3. POST /matters/{id}/fabrics — attach two fabrics"
for FAB in fab_term_sheet fab_diligence; do
  RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/fabrics" \
    -H "Content-Type: application/json" \
    -H "X-Pact-Principal: did:web:knox.example" \
    -d "{\"resourceId\": \"${FAB}\"}")
  assert "${FAB} attached" "True" "$(echo "$RESP" | jq_get attached)"
done

# ── 4. post side-channel messages ─────────────────────────────────────────
echo ""
echo "4. POST /matters/{id}/messages — typed-event side-channel"
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/messages" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"content": "Term sheet up for review", "fabric_id": "fab_term_sheet"}')
assert "message.body.format=text" "text" "$(echo "$RESP" | jq_get message.body.format)"
assert "references.fabric_id set" "fab_term_sheet" "$(echo "$RESP" | jq_get message.references.fabric_id)"
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/messages" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:counterparty.example" \
  -d '{"content": "Reviewing now"}')
assert "cross-org sender accepted" "did:web:counterparty.example" "$(echo "$RESP" | jq_get message.sender_principal)"

# ── 5. manifest — same-org and cross-org views ────────────────────────────
echo ""
echo "5. GET /matters/{id}/manifest — Knox view"
RESP=$(curl -sS "${BASE}/api/pact/matters/${MID}/manifest" \
  -H "X-Pact-Principal: did:web:knox.example")
assert "Knox sees self as owner" "owner" "$(echo "$RESP" | jq_get caller.role)"
assert "counterparty marked cross_org" "True" "$(echo "$RESP" | jq_get counterparties.0.cross_org)"
assert "both fabrics surfaced" "2" "$(echo "$RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['fabrics']))")"

echo ""
echo "6. GET /matters/{id}/manifest — Counterparty view"
RESP=$(curl -sS "${BASE}/api/pact/matters/${MID}/manifest" \
  -H "X-Pact-Principal: did:web:counterparty.example")
assert "Counterparty sees self as participant" "participant" "$(echo "$RESP" | jq_get caller.role)"
assert "Knox appears as cross_org" "True" "$(echo "$RESP" | jq_get counterparties.0.cross_org)"

# ── 7. attempt non-member access ──────────────────────────────────────────
echo ""
echo "7. GET /matters/{id}/manifest — non-member rejected"
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/api/pact/matters/${MID}/manifest" \
  -H "X-Pact-Principal: did:web:stranger.example")
assert "non-member gets 403" "403" "$STATUS"

# ── 8. close Matter ──────────────────────────────────────────────────────
echo ""
echo "8. POST /matters/{id}/close — close with outcome"
RESP=$(curl -sS -X POST "${BASE}/api/pact/matters/${MID}/close" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"outcome": "smoke-test-complete"}')
assert "phase=closed" "closed" "$(echo "$RESP" | jq_get phase)"
assert "fabrics_detached=false (no cascade)" "False" "$(echo "$RESP" | jq_get fabrics_detached)"

# ── 9. attempt mutation on closed Matter ─────────────────────────────────
echo ""
echo "9. POST /matters/{id}/messages on closed Matter — rejected"
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/pact/matters/${MID}/messages" \
  -H "Content-Type: application/json" \
  -H "X-Pact-Principal: did:web:knox.example" \
  -d '{"content": "should fail"}')
assert "closed Matter rejects message" "409" "$STATUS"

# ── summary ─────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo "  PASS: ${PASS}    FAIL: ${FAIL}"
echo "────────────────────────────────────────"

exit $([[ $FAIL -eq 0 ]] && echo 0 || echo 1)
