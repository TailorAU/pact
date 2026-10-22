"""Registration proof-of-work client for PACT (tailor-group#7).

POST /api/pact/register answers 428 with a signed challenge; the caller
finds a nonce such that sha256(f"{challenge}:{nonce}") has at least `bits`
leading zero bits and repeats the POST with ``{"pow": {"challenge", "nonce"}}``.
At the default 20 bits this is ~1 s of CPU in CPython.

    from pact_pow import register
    code, data = register("https://pact.tailor.au", {"agentName": "my-agent"})

Leaf module: stdlib + requests only.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any

import requests


def leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        bits += 8 - byte.bit_length()
        break
    return bits


def solve(challenge: str, bits: int) -> str:
    """Return a nonce meeting the difficulty. Deterministic counter search."""
    prefix = f"{challenge}:".encode()
    i = 0
    while True:
        nonce = format(i, "x")
        if leading_zero_bits(hashlib.sha256(prefix + nonce.encode()).digest()) >= bits:
            return nonce
        i += 1


def register(base: str, payload: dict[str, Any], timeout: int = 30, attempts: int = 3) -> tuple[int, Any]:
    """POST /api/pact/register, solving the proof-of-work challenge when asked.

    Returns (status_code, json_or_text). Retries a fresh challenge if the
    server rejects one (expired / already used); other statuses return as-is.
    """
    url = f"{base}/api/pact/register"
    body = dict(payload)
    for _ in range(attempts):
        r = None
        for net_attempt in range(4):
            try:
                r = requests.post(url, json=body, timeout=timeout)
                break
            except requests.RequestException as e:
                if net_attempt == 3:
                    print(f"  NETWORK ERR on POST /api/pact/register: {e}")
                    return 0, {"error": f"network: {e}"}
                time.sleep(5 * (net_attempt + 1))
        assert r is not None
        try:
            data = r.json()
        except ValueError:
            data = r.text[:400]
        if r.status_code != 428 or not isinstance(data, dict) or "pow" not in data:
            return r.status_code, data
        pow_spec = data["pow"]
        t0 = time.time()
        nonce = solve(pow_spec["challenge"], int(pow_spec["bits"]))
        body["pow"] = {"challenge": pow_spec["challenge"], "nonce": nonce}
        print(f"  pow solved ({pow_spec['bits']} bits) in {time.time() - t0:.1f}s")
    return r.status_code, data
