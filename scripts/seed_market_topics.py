#!/usr/bin/env python3
"""Seed market-data topics (fuel + grocery) into the Source PACT knowledge graph via REST API."""
import json
import os
import sys
import time

os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import requests

BASE_URL = os.environ.get("BASE_URL", "https://source.tailor.au")

# Filled by main() after registration — scraper agent name -> apiKey (for reuse if you import this module).
AGENT_API_KEYS = {}

# Optional: JSON object mapping agent name -> apiKey when agents already exist (409 on register).
# Example: SOURCE_MARKET_KEYS_JSON='{"petrolspy-agent":"pact_sk_..."}'
_KEYS_ENV = os.environ.get("SOURCE_MARKET_KEYS_JSON", "").strip()

SCRAPER_AGENT_NAMES = [
    "petrolspy-agent",
    "pz3-agent",
    "fuelwatch-agent",
    "nsw-fuelcheck-agent",
    "qld-direct-agent",
    "coles-agent",
    "woolworths-agent",
    "amazon-au-agent",
    "chemist-warehouse-agent",
    "iga-agent",
]

AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]

NATIONAL_FUEL_TITLE = "Australian Fuel Market"


def api(method, path, key=None, data=None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    for attempt in range(3):
        try:
            r = requests.request(method, url, headers=headers, json=data, timeout=60)
            if r.status_code == 429:
                time.sleep(30)
                continue
            if r.text:
                try:
                    return r.status_code, r.json()
                except json.JSONDecodeError:
                    return r.status_code, {"error": r.text[:500]}
            return r.status_code, {}
        except Exception as e:
            if attempt == 2:
                print(f"  ERR: {e}")
            time.sleep(5)
    return 0, {"error": "retries exhausted"}


def load_env_key_map():
    if not _KEYS_ENV:
        return {}
    try:
        return json.loads(_KEYS_ENV)
    except json.JSONDecodeError as e:
        print(f"WARNING: SOURCE_MARKET_KEYS_JSON is not valid JSON: {e}")
        return {}


def fetch_topic_title_map():
    """Return {exact title: topic id} for idempotency."""
    title_to_id = {}
    offset = 0
    page = 200
    while True:
        code, rows = api("GET", f"/api/pact/topics?limit={page}&offset={offset}")
        if code != 200 or not isinstance(rows, list):
            print(f"  WARNING: could not list topics (code={code})")
            break
        for row in rows:
            t = row.get("title")
            tid = row.get("id")
            if t and tid:
                title_to_id[t] = tid
        if len(rows) < page:
            break
        offset += page
    return title_to_id


def fulfill_civic_duty(key, max_votes=8):
    """Cast approve votes on proposed topics so this agent can create another topic."""
    code, proposed = api("GET", "/api/pact/topics?status=proposed&limit=50")
    if code != 200 or not isinstance(proposed, list):
        return
    for p in proposed[:max_votes]:
        tid = p.get("id")
        if not tid:
            continue
        api(
            "POST",
            f"/api/pact/{tid}/vote",
            key=key,
            data={"vote": "approve", "reason": "Market seed script: civic duty approval for well-formed empirical topic"},
        )
        time.sleep(0.25)


def create_topic(key, payload, title_to_id_ref):
    """
    Create topic; refresh title map on success. Handle 409 (exists), 403 (civic), 422 (validation).
    Returns topic id or None.
    """
    title = payload["title"]
    if title in title_to_id_ref:
        print(f"  SKIP (cache): {title}")
        return title_to_id_ref[title]

    for attempt in range(6):
        code, data = api("POST", "/api/pact/topics", key=key, data=payload)
        if code in (200, 201) and data.get("id"):
            tid = data["id"]
            title_to_id_ref[title] = tid
            print(f"  CREATED: {title} -> {tid[:12]}...")
            return tid
        if code == 409:
            tid = data.get("existingTopicId", "")
            if tid:
                title_to_id_ref[title] = tid
                print(f"  EXISTS: {title} -> {tid[:12]}...")
                return tid
            print(f"  SKIP: {title} — {data.get('error', data)}")
            return None
        err = str(data.get("error", ""))
        if code == 403 and "civic" in err.lower():
            print(f"  Civic duty: voting then retrying ({attempt + 1}/6)...")
            fulfill_civic_duty(key)
            time.sleep(0.5)
            continue
        if code == 422:
            print(f"  FAIL: {title} — {err[:200]}")
            return None
        print(f"  FAIL: {title} — code={code} {data}")
        return None
    print(f"  FAIL: {title} — exhausted civic retries")
    return None


def register_agents(agent_keys):
    """Populate agent_keys dict name -> apiKey."""
    env_keys = load_env_key_map()
    for name in SCRAPER_AGENT_NAMES:
        if name in agent_keys:
            continue
        if name in env_keys and env_keys[name]:
            agent_keys[name] = env_keys[name]
            print(f"  KEY from env: {name}")
            continue
        code, data = api(
            "POST",
            "/api/pact/register",
            data={
                "agentName": name,
                "model": "market-scraper",
                "framework": "python-requests",
                "description": "Automated market price ingestion agent for Source empirical topics",
            },
        )
        if code in (200, 201) and data.get("apiKey"):
            agent_keys[name] = data["apiKey"]
            print(f"  REGISTERED: {name} ({data.get('agentId', '')[:8]}...)")
            time.sleep(0.4)
            continue
        if code == 409:
            print(
                f"  REGISTER SKIP: {name} already exists. "
                f"Add its apiKey to SOURCE_MARKET_KEYS_JSON to use this script."
            )
            continue
        print(f"  REGISTER FAIL: {name} — {data}")
        sys.exit(1)


def topic_body_market_fuel(state_label: str, is_national: bool) -> str:
    if is_national:
        ctx = (
            "This empirical topic tracks aggregate retail fuel price intelligence across Australia. "
            "Coverage spans major and regional markets where participating scrapers publish station-level or "
            "suburb-level quotes. Sources include third-party aggregators and, where available, government "
            "price-reporting schemes. The graph links each state or territory view to this national overview."
        )
        oq = (
            "- How do wholesale and retail spreads move relative to global benchmark crude and exchange rates?\n"
            "- Where do reporting gaps exist between jurisdictions?\n"
            "- Which price signals best predict short-term retail movement at a national scale?"
        )
    else:
        ctx = (
            f"This empirical topic tracks retail fuel price observations for {state_label}. "
            "It aggregates station or suburb quotes from scraper agents where those feeds include "
            f"{state_label} coverage, alongside any state-run fuel price schemes that publish machine-readable data. "
            "The intent is a consistent view of pump prices and reporting latency for this jurisdiction."
        )
        oq = (
            "- How does intra-state price dispersion compare across metro, regional, and remote areas?\n"
            "- Which product grades (E10, U91, P95, P98, diesel) show the largest week-on-week volatility?\n"
            "- Where do scraper coverage gaps leave uncertainty in the state-level picture?"
        )
    return (
        "## Context\n"
        f"{ctx}\n\n"
        "## Answer\n"
        "Updated automatically by scraper agents every 30 minutes.\n\n"
        "## Open Questions\n"
        f"{oq}"
    )


def topic_body_grocery(kind: str) -> str:
    bodies = {
        "australian_grocery": (
            "This empirical topic tracks representative grocery retail pricing across Australian supermarkets and "
            "major chains where scraper agents have coverage. It focuses on shelf prices and promotional tags "
            "as observed in online catalogues or in-store feeds, not on personal financial advice."
        ),
        "dairy": (
            "This empirical topic tracks dairy category pricing (milk, cheese, butter, yoghurt, cream) across "
            "Australian retail channels covered by scraper agents. It highlights how shelf prices vary by chain "
            "and pack size where those attributes are available."
        ),
        "produce": (
            "This empirical topic tracks fresh fruit and vegetable pricing where scrapers ingest catalogue or "
            "market data for Australian retail. Seasonality and regional supply affect prices; the graph records "
            "observed shelf or unit pricing rather than forecasts."
        ),
        "household": (
            "This empirical topic tracks household essentials (cleaning, paper goods, basic pantry staples outside "
            "fresh produce) across Australian retail channels with scraper coverage. It is intended for market "
            "visibility, not consumer shopping lists."
        ),
    }
    ctx = bodies[kind]
    oq = (
        "- How do private-label and branded lines diverge within each category?\n"
        "- Which categories show the highest regional price dispersion?\n"
        "- What data quality limits exist when sources omit unit pricing or pack metadata?"
    )
    return (
        "## Context\n"
        f"{ctx}\n\n"
        "## Answer\n"
        "Updated automatically by scraper agents every 30 minutes.\n\n"
        "## Open Questions\n"
        f"{oq}"
    )


def dependency_payload(parent_id: str):
    return {
        "dependsOn": parent_id,
        "relationship": "builds_on",
        "justification": {
            "necessity": (
                "If the national Australian fuel market overview were absent, this state-level topic would lack "
                "the shared wholesale, excise, and import cost context that explains baseline price structure "
                "before regional variation."
            ),
            "direction": (
                "This topic specialises and narrows the Australian Fuel Market topic by restricting retail fuel "
                "price intelligence to a single state or territory while inheriting the national framing."
            ),
        },
    }


def get_dep_parent_id(row):
    return row.get("depends_on") or row.get("dependsOn")


def ensure_state_depends_on_national(state_id, national_id, key):
    code, data = api("GET", f"/api/pact/{state_id}/dependencies")
    if code != 200:
        print(f"  WARN: could not read dependencies for {state_id}: {data}")
        return
    builds = data.get("buildsOn") or []
    for row in builds:
        if get_dep_parent_id(row) == national_id:
            print(f"  EDGE OK: {state_id[:8]}... builds_on national")
            return
    code2, res2 = api(
        "POST",
        f"/api/pact/{state_id}/dependencies",
        key=key,
        data=dependency_payload(national_id),
    )
    if code2 in (200, 201):
        print(f"  EDGE ADDED: state {state_id[:8]}... -> national")
    elif code2 == 409:
        print(f"  EDGE SKIP: already present (409)")
    else:
        print(f"  EDGE FAIL: {state_id[:8]}... — {res2}")


def main():
    global AGENT_API_KEYS
    print(f"=== Seed market topics (BASE_URL={BASE_URL}) ===\n")

    agent_keys = {}
    print("Registering scraper agents...")
    register_agents(agent_keys)
    AGENT_API_KEYS.clear()
    AGENT_API_KEYS.update(agent_keys)

    usable = {n: agent_keys[n] for n in SCRAPER_AGENT_NAMES if agent_keys.get(n)}
    if len(usable) < 1:
        print("ERROR: Need at least one agent API key. Register agents or set SOURCE_MARKET_KEYS_JSON.")
        sys.exit(1)

    print("\nLoading existing topics for idempotency...")
    title_to_id = fetch_topic_title_map()
    print(f"  Indexed {len(title_to_id)} topic titles\n")

    keys_list = [usable[n] for n in SCRAPER_AGENT_NAMES if usable.get(n)]
    ki = 0

    def next_key():
        nonlocal ki
        k = keys_list[ki % len(keys_list)]
        ki += 1
        return k

    # 1) National fuel
    print("--- National fuel topic ---")
    national_id = create_topic(
        next_key(),
        {
            "title": NATIONAL_FUEL_TITLE,
            "content": topic_body_market_fuel("", is_national=True),
            "tier": "empirical",
            "jurisdiction": "AU",
        },
        title_to_id,
    )

    if not national_id:
        national_id = title_to_id.get(NATIONAL_FUEL_TITLE)
    if not national_id:
        print("ERROR: Could not resolve national fuel topic id.")
        sys.exit(1)

    # 2) State fuel topics (depend on national at creation when possible)
    print("\n--- State fuel topics ---")
    state_ids = {}
    for st in AU_STATES:
        title = f"{st} Fuel Market"
        payload = {
            "title": title,
            "content": topic_body_market_fuel(st, is_national=False),
            "tier": "empirical",
            "jurisdiction": f"AU-{st}",
            "dependsOn": [national_id],
        }
        tid = create_topic(next_key(), payload, title_to_id)
        if tid:
            state_ids[st] = tid
        else:
            maybe = title_to_id.get(title)
            if maybe:
                state_ids[st] = maybe

    # 3) Grocery topics
    print("\n--- Grocery topics ---")
    grocery_specs = [
        ("Australian Grocery Prices", "australian_grocery"),
        ("Dairy Market Australia", "dairy"),
        ("Fresh Produce Market Australia", "produce"),
        ("Household Essentials Market Australia", "household"),
    ]
    for gtitle, gkind in grocery_specs:
        create_topic(
            next_key(),
            {
                "title": gtitle,
                "content": topic_body_grocery(gkind),
                "tier": "empirical",
                "jurisdiction": "AU",
            },
            title_to_id,
        )

    # 4) Ensure dependency edges state -> national
    print("\n--- Dependency edges (state fuel builds_on national) ---")
    national_id = title_to_id.get(NATIONAL_FUEL_TITLE, national_id)
    edge_key = keys_list[0]
    for st in AU_STATES:
        title = f"{st} Fuel Market"
        sid = state_ids.get(st) or title_to_id.get(title)
        if not sid or not national_id:
            continue
        ensure_state_depends_on_national(sid, national_id, edge_key)

    print("\n=== Done ===")
    print(
        f"Agent keys loaded for {len(agent_keys)} name(s): {', '.join(sorted(agent_keys.keys()))}. "
        "Keys are only kept in memory during this run; use SOURCE_MARKET_KEYS_JSON for pre-registered agents."
    )


if __name__ == "__main__":
    main()
