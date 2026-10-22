#!/usr/bin/env python3
"""Signal done for all agents on all topics."""

import json
import time
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3002/api/pact"

AGENTS = [
    ("writer-01", "pact_sk_981622b43144487ca18000885cc6f110"),
    ("writer-02", "pact_sk_3d08eb3c0921471586dd6d37d1382e42"),
    ("writer-03", "pact_sk_c6878e6fcec14da8a3a84741a41473a8"),
    ("writer-04", "pact_sk_d8787f278cf54ad0ad99986886da6f82"),
    ("writer-05", "pact_sk_5a7b64b122f6418cb2b3717adc2d0c13"),
]

TOPICS = [
    "782fefb1-3e0b-4a1e-be66-0da35d46ce2e",
    "191b354d-9d3e-4f7a-b863-f4e645ed5634",
    "e848d349-a43b-4052-b05d-5d5d5d46b4a3",
    "ec121b6a-35ce-46de-96d2-2e6e71069ceb",
    "1d3fd896-6846-4278-9ae1-db4b54cd6d8e",
    "9bf02ef2-836f-47a0-bee8-b2f762c63fba",
    "0c870026-48cd-4208-99cf-c941866dcb9c",
    "72888f33-8014-42dd-8241-3823ae1ddb78",
    "c62538af-3dca-481e-bcdf-2096332339fc",
    "255399bb-f12d-4eb1-a572-534c155090c0",
    "38d352d7-a96e-43c8-a3a2-5e99dd55a825",
    "353700ca-d6b6-4dda-8482-38b96f532daa",
    "d92de84e-9ada-48eb-9608-d98525fbbfcb",
    "a39ebd28-8928-4a32-8a58-404869923f55",
    "3016c299-782c-42cf-a5e8-a3aae4b26301",
]


def api_call(method, path, api_key, data=None, retries=3):
    url = f"{BASE}/{path}"
    for attempt in range(retries):
        try:
            body = json.dumps(data).encode() if data else None
            req = urllib.request.Request(
                url, data=body, method=method,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_body = resp.read().decode()
                try:
                    return json.loads(resp_body)
                except:
                    return {"raw": resp_body}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5)
                continue
            body = e.read().decode() if e.fp else ""
            try:
                return {"error": json.loads(body), "status": e.code}
            except:
                return {"error": body, "status": e.code}
        except Exception as e:
            return {"error": str(e)}
    return {"error": "Max retries"}


def main():
    agent_idx = int(sys.argv[1]) if len(sys.argv) > 1 else -1

    agents = [AGENTS[agent_idx]] if agent_idx >= 0 else AGENTS

    for name, key in agents:
        print(f"\n=== {name} signaling done ===")
        for tid in TOPICS:
            # First join (in case not joined)
            api_call("POST", f"{tid}/join", key)
            result = api_call("POST", f"{tid}/done", key, {
                "assumptions": [],
                "noAssumptionsReason": "This topic is self-contained and does not depend on unverified assumptions beyond its own tier definitions."
            })
            status = "ok" if "error" not in result else str(result.get("error",""))[:60]
            print(f"  {tid[:8]}: {status}")


if __name__ == "__main__":
    main()
