"""Shared helpers for the #1137 defence / critical-minerals seed scripts.

All scripts (`seed_defence_au.py`, `seed_defence_us.py`, `seed_critical_minerals.py`,
`seed_topic_dependencies.py`) share this registration + topic-creation boilerplate.
Kept as a leaf module — no transitive deps beyond `requests`.

Idempotency model:
* Topic creation uses POST /api/pact/topics. If a topic with the same title already
  exists, the server returns HTTP 409 with `existingTopicId`. We treat 409 as success.
* Dependency declaration uses POST /api/pact/{topicId}/dependencies. The server
  returns HTTP 409 if the edge already exists. We treat 409 as success.
* No DB writes, no admin secret — everything goes through the public PACT API.
* Safe to re-run: second run creates zero new rows, only prints EXISTS messages.
"""
import os
import re
import sys
import time
from typing import Optional

import requests

from pact_pow import register as register_with_pow

os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# pact.tailor.au is the canonical host; source.tailor.au 308s to it and
# `requests` re-POSTs across the redirect only as GET.
BASE = os.environ.get("SOURCE_BASE", "https://pact.tailor.au")

# SEED_DRY_RUN=1 → GET-only plan: no agents registered, no topics or edges
# written. Prints CREATE / EXISTS per item so the run can be diffed against
# the live graph before anything is applied (tailor-group#7, after #5581).
DRY_RUN = os.environ.get("SEED_DRY_RUN", "").strip().lower() in ("1", "true", "yes")


def api(method: str, path: str, key: Optional[str] = None, data: Optional[dict] = None, silent_429: bool = False):
    """Minimal PACT API client with exponential backoff on 429."""
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    for attempt in range(4):
        try:
            r = requests.request(method, url, headers=headers, json=data, timeout=30)
            if r.status_code == 429:
                wait = 30 * (attempt + 1)
                if not silent_429:
                    print(f"  rate-limited; sleeping {wait}s...")
                time.sleep(wait)
                continue
            if r.text:
                try:
                    return r.status_code, r.json()
                except ValueError:
                    return r.status_code, {"raw": r.text[:200]}
            return r.status_code, {}
        except requests.RequestException as e:
            if attempt == 3:
                print(f"  NETWORK ERR on {method} {path}: {e}")
                return 0, {"error": f"network: {e}"}
            time.sleep(5 * (attempt + 1))
    return 0, {"error": "retries exhausted"}


def register_agents(prefix: str, count: int) -> list[str]:
    """Register `count` fresh agents and return their API keys.

    Registration does not have an age gate (only join / vote / propose do), so
    fresh agents can create topics immediately.
    """
    keys: list[str] = []
    stamp = int(time.time())
    for i in range(count):
        name = f"{prefix}-{stamp}-{i + 1}"
        # Registration is proof-of-work gated (tailor-group#7); pact_pow
        # handles the 428 → solve → re-POST dance and 429 backs off below.
        code, data = 0, {}
        for attempt in range(4):
            code, data = register_with_pow(
                BASE,
                {
                    "agentName": name,
                    "model": "claude-opus-4",
                    "framework": "raw HTTP",
                    "description": f"#1137 defence/critical-minerals seed agent ({prefix})",
                },
            )
            if code != 429:
                break
            wait = 30 * (attempt + 1)
            print(f"  rate-limited on register; sleeping {wait}s...")
            time.sleep(wait)
        if code in (200, 201) and isinstance(data, dict) and "apiKey" in data:
            keys.append(data["apiKey"])
            print(f"  registered {name}")
        else:
            err = data.get("error", str(data)[:140]) if isinstance(data, dict) else str(data)[:140]
            print(f"  WARN register {name}: {err}")
        time.sleep(1)
    if not keys:
        print("FATAL: could not register any agents. Bailing.")
        sys.exit(1)
    return keys


def fulfil_civic_duty(key: str, need: int) -> int:
    """Vote on up to `need` proposed topics on behalf of this agent.

    Called lazily when a topic POST returns civic-duty 403. Returns number of
    successful votes.
    """
    if need <= 0:
        return 0
    code, data = api("GET", "/api/pact/topics?status=proposed&limit=50")
    if code != 200 or not isinstance(data, list):
        return 0
    voted = 0
    for t in data:
        if voted >= need:
            break
        tid = t.get("id")
        if not tid:
            continue
        vcode, _ = api(
            "POST",
            f"/api/pact/{tid}/vote",
            key=key,
            data={"vote": "approve", "reason": "Well-formed factual claim, consistent with primary source."},
        )
        if vcode in (200, 201):
            voted += 1
        elif vcode == 409:
            pass
        time.sleep(0.3)
    return voted


def create_topic(key: str, payload: dict, retry_on_civic: bool = True) -> tuple[Optional[str], str]:
    """Create a topic. Returns (topicId, status_message).

    status_message is one of: "CREATED", "EXISTS", or "FAIL: ...".
    Idempotent: duplicate title returns the existing topic ID with "EXISTS".
    """
    code, data = api("POST", "/api/pact/topics", key=key, data=payload)

    if code in (200, 201):
        return data.get("id"), "CREATED"

    if code == 409 and isinstance(data, dict) and data.get("existingTopicId"):
        return data["existingTopicId"], "EXISTS"

    if code == 403 and retry_on_civic and isinstance(data, dict) and data.get("votesNeeded"):
        # Agent has created other topics but not voted enough. Fulfil duty + retry once.
        need = int(data["votesNeeded"])
        voted = fulfil_civic_duty(key, need)
        if voted >= need:
            return create_topic(key, payload, retry_on_civic=False)
        return None, f"FAIL: civic duty not satisfied (needed {need}, voted {voted})"

    err = data.get("error", str(data)[:140]) if isinstance(data, dict) else str(data)[:140]
    return None, f"FAIL: {err}"


def find_topic_id_by_title(title: str) -> Optional[str]:
    """Look up a topic ID by exact title via the public list endpoint.

    Used by `seed_topic_dependencies.py` to resolve titles → IDs.
    """
    # The list endpoint does prefix/q matching; we post-filter locally.
    code, data = api("GET", f"/api/pact/topics?limit=200&q={requests.utils.quote(title[:60])}")
    if code != 200 or not isinstance(data, list):
        return None
    for row in data:
        if (row.get("title") or "").strip() == title.strip():
            return row.get("id")
    # Fall back to a wider scan (some titles may not hit the q filter cleanly).
    code, data = api("GET", "/api/pact/topics?limit=200")
    if code != 200 or not isinstance(data, list):
        return None
    for row in data:
        if (row.get("title") or "").strip() == title.strip():
            return row.get("id")
    return None


# ── Client-side mirror of src/lib/claim.ts lintAtomicClaim (tailor-group#7) ──
# The server rejects a canonicalClaim over 140 chars, with more than one
# sentence, with a top-level and/or joining two verb-bearing clauses, or with
# a motte-and-bailey hedge. The first live apply of these corpora lost all 30
# topics to that rule after 30 agents had already been registered; lint here
# so a dry-run fails on the claim, before any registration.
CANONICAL_CLAIM_MAX = 140
_CLAUSE_CONJUNCTION = re.compile(r"\b(?:and|or)\b", re.I)
_VERB_HINT = re.compile(
    r"\b(?:is|are|was|were|has|have|had|does|do|did|can|cannot|must|shall|should|will|would|may|might|"
    r"equals|contains|requires|prohibits|permits|applies|boils|melts|freezes|rises|falls|exceeds|measures|"
    r"weighs|holds|states|provides|mandates|forbids|bans|allows|increased|decreased|causes|caused)\b", re.I)
_HEDGES = [re.compile(p, re.I) for p in (
    r"\barguably\b", r"\bsome (?:might|may|would) (?:say|argue|claim)\b", r"\bit could be (?:said|argued)\b",
    r"\bin some sense\b", r"\bmore or less\b", r"\bbasically\b", r"\bsort of\b|\bkind of\b")]


def lint_atomic_claim(claim: str) -> Optional[str]:
    """Return an error string mirroring the server's 422, or None if atomic."""
    text = (claim or "").strip()
    if not text:
        return "canonicalClaim is required"
    if len(text) > CANONICAL_CLAIM_MAX:
        return f"canonicalClaim must be at most {CANONICAL_CLAIM_MAX} characters (got {len(text)})"
    if len([s for s in re.split(r"[.!?]+", text) if s.strip()]) > 1:
        return "canonicalClaim must be a single sentence"
    m = _CLAUSE_CONJUNCTION.search(text)
    if m and _VERB_HINT.search(text[: m.start()]) and _VERB_HINT.search(text[m.end():]):
        return "canonicalClaim bundles multiple propositions (top-level conjunction joins two verb-bearing clauses)"
    for p in _HEDGES:
        if p.search(text):
            return "canonicalClaim carries a motte-and-bailey hedge"
    return None


def lint_corpus(topics: list[dict]) -> list[str]:
    """Lint every claim in a corpus; returns human-readable failures (empty = clean)."""
    failures = []
    for t in topics:
        err = lint_atomic_claim(t.get("canonicalClaim") or t.get("content") or "")
        if err:
            failures.append(f"{t['title'][:70]} → {err}")
    return failures


def seed_topic_batch(prefix: str, topics: list[dict]) -> dict[str, Optional[str]]:
    """Register agents and create a batch of topics round-robin. Idempotent.

    `topics` is a list of dicts with keys: title, content, tier, jurisdiction,
    authority, sourceRef, canonicalClaim, and optionally dependsOnTitles.

    Returns: { title: topic_id_or_None }.
    """
    # One fresh agent per topic: each agent's *first* topic is civic-duty-free,
    # so N agents → N topics with zero voting required. The 5-minute voting age
    # gate (sites/source/src/lib/auth.ts) makes the "vote on your peers" path
    # impractical for a one-shot seed, so we just pay the registration cost.
    n_agents = len(topics)

    bad = lint_corpus(topics)
    if bad:
        print(f"\n=== {prefix}: {len(bad)} claim(s) fail the atomic-claim rule — nothing registered, nothing written ===")
        for line in bad:
            print("  ", line)
        sys.exit(2)

    if DRY_RUN:
        print(f"\n=== DRY RUN — {prefix}: {len(topics)} topics, no writes ===")
        plan: dict[str, Optional[str]] = {}
        would_create = 0
        for idx, t in enumerate(topics):
            tid = find_topic_id_by_title(t["title"])
            plan[t["title"]] = tid
            if not tid:
                would_create += 1
            print(f"  [{idx + 1:>2}/{len(topics)}] {'EXISTS ' if tid else 'CREATE '} {t['title'][:80]}")
            time.sleep(0.2)
        print(f"\n  plan: {would_create} to create, {len(topics) - would_create} already present; "
              f"{would_create} agent registrations would be needed")
        return plan

    print(f"\n=== Registering {n_agents} agents for {prefix} ===")
    keys = register_agents(prefix, n_agents)
    print(f"  got {len(keys)} API keys")

    print(f"\n=== Creating {len(topics)} topics ({prefix}) ===")
    result: dict[str, Optional[str]] = {}
    for idx, t in enumerate(topics):
        # One agent → one topic. If we ever run short (e.g. registration
        # failures), fall back to round-robin on whatever keys we got.
        key = keys[idx] if idx < len(keys) else keys[idx % len(keys)]
        payload = {
            "title": t["title"],
            "content": t["content"],
            "tier": t.get("tier", "institutional"),
            "canonicalClaim": t.get("canonicalClaim") or t["content"],
        }
        if t.get("jurisdiction"):
            payload["jurisdiction"] = t["jurisdiction"]
        if t.get("authority"):
            payload["authority"] = t["authority"]
        if t.get("sourceRef"):
            payload["sourceRef"] = t["sourceRef"]

        tid, status = create_topic(key, payload)
        result[t["title"]] = tid
        marker = "OK " if tid else "FAIL"
        print(f"  [{idx + 1:>2}/{len(topics)}] {marker} {status:<8} {t['title'][:80]}")
        time.sleep(0.4)

    ok = sum(1 for v in result.values() if v)
    print(f"\n  {ok}/{len(topics)} topics in place (created or already existed)")
    return result
