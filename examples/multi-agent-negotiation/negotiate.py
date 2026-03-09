"""
Multi-Agent Negotiation — Two agents negotiate contract terms using PACT.

Scenario:
  - Commercial agent publishes constraints (budget caps)
  - Legal agent declares intent, reads constraints, proposes edits
  - Auto-merge via silence-is-consent, or objection triggers renegotiation

Usage:
  export PACT_BASE_URL="https://tailor.au"
  export PACT_INVITE_TOKEN_LEGAL="token_for_legal_agent"
  export PACT_INVITE_TOKEN_COMMERCIAL="token_for_commercial_agent"
  python negotiate.py --doc-id YOUR_DOC_ID
"""

import argparse
import os
import sys
import time

import requests

BASE_URL = os.environ.get("PACT_BASE_URL", "https://tailor.au")


class PACTAgent:
    """Minimal PACT agent for negotiation demos."""

    def __init__(self, base_url: str, agent_name: str):
        self.base_url = base_url.rstrip("/")
        self.agent_name = agent_name
        self.api_key = None
        self.doc_id = None

    def _headers(self) -> dict:
        return {"X-Api-Key": self.api_key, "Content-Type": "application/json"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/pact/{self.doc_id}/{path}"

    def join(self, doc_id: str, invite_token: str):
        self.doc_id = doc_id
        resp = requests.post(
            self._url("join-token"),
            json={"agentName": self.agent_name, "token": invite_token},
        )
        resp.raise_for_status()
        data = resp.json()
        self.api_key = data["apiKey"]
        print(f"[{self.agent_name}] Joined document")

    def publish_constraint(self, section_id: str, boundary: str, category: str):
        requests.post(
            self._url("constraints"),
            json={"sectionId": section_id, "boundary": boundary, "category": category},
            headers=self._headers(),
        )
        print(f"[{self.agent_name}] Constraint: {boundary}")

    def set_salience(self, section_id: str, score: int):
        requests.post(
            self._url("salience"),
            json={"sectionId": section_id, "score": score},
            headers=self._headers(),
        )
        print(f"[{self.agent_name}] Salience on {section_id}: {score}/10")

    def declare_intent(self, section_id: str, goal: str, category: str):
        requests.post(
            self._url("intents"),
            json={"sectionId": section_id, "goal": goal, "category": category},
            headers=self._headers(),
        )
        print(f"[{self.agent_name}] Intent: {goal}")

    def get_constraints(self, section_id: str) -> list:
        resp = requests.get(
            self._url("constraints"),
            params={"sectionId": section_id},
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def propose(self, section_id: str, content: str, summary: str) -> str:
        resp = requests.post(
            self._url("proposals"),
            json={"sectionId": section_id, "newContent": content, "summary": summary},
            headers=self._headers(),
        )
        resp.raise_for_status()
        proposal_id = resp.json()["id"]
        print(f"[{self.agent_name}] Proposed: {summary}")
        return proposal_id

    def object_proposal(self, proposal_id: str, reason: str):
        requests.post(
            self._url(f"proposals/{proposal_id}/object"),
            json={"reason": reason},
            headers=self._headers(),
        )
        print(f"[{self.agent_name}] Objected: {reason}")

    def escalate(self, section_id: str, message: str):
        requests.post(
            self._url("escalate"),
            json={"sectionId": section_id, "message": message},
            headers=self._headers(),
        )
        print(f"[{self.agent_name}] Escalated to human: {message}")

    def done(self, status: str, summary: str):
        requests.post(
            self._url("done"),
            json={"status": status, "summary": summary},
            headers=self._headers(),
        )
        print(f"[{self.agent_name}] Done: {summary}")


def run_negotiation(doc_id: str, legal_token: str, commercial_token: str):
    """Simulate a two-agent negotiation."""

    target_section = "sec:liability"

    # --- Phase 1: Commercial agent sets boundaries ---
    print("\n=== Phase 1: Commercial Agent Sets Constraints ===\n")
    commercial = PACTAgent(BASE_URL, "commercial-agent")
    commercial.join(doc_id, commercial_token)
    commercial.publish_constraint(
        target_section,
        "Total liability cap must not exceed $2M AUD",
        category="commercial",
    )
    commercial.publish_constraint(
        target_section,
        "No uncapped indemnity clauses",
        category="commercial",
    )
    commercial.set_salience(target_section, 9)

    # --- Phase 2: Legal agent reads constraints and proposes ---
    print("\n=== Phase 2: Legal Agent Reads Constraints & Proposes ===\n")
    legal = PACTAgent(BASE_URL, "legal-agent")
    legal.join(doc_id, legal_token)

    # Read what constraints exist
    constraints = legal.get_constraints(target_section)
    print(f"[legal-agent] Found {len(constraints)} constraints:")
    for c in constraints:
        print(f"  - {c['boundary']}")

    # Declare intent
    legal.declare_intent(
        target_section,
        "Add mutual indemnity clause with currency risk allocation",
        category="legal",
    )

    # Propose change that respects constraints
    legal.propose(
        target_section,
        "## Liability\n\n"
        "Each party indemnifies the other against direct losses arising from breach, "
        "capped at $1.5M AUD per incident and $2M AUD in aggregate. "
        "Currency risk on cross-border payments is borne by the paying party.",
        "Mutual indemnity with $2M aggregate cap — within commercial constraints",
    )

    # --- Phase 3: Wait for consensus ---
    print("\n=== Phase 3: Consensus ===\n")
    print("Proposal submitted. In a live system:")
    print("  - If no objection within TTL → auto-merged (silence = consent)")
    print("  - If commercial agent objects → renegotiation cycle begins")
    print("  - If agents can't converge → escalation to human reviewer")

    # Signal done
    legal.done("aligned", "Liability clause proposed within constraints")
    commercial.done("aligned", "Constraints published, monitoring proposals")


def main():
    parser = argparse.ArgumentParser(description="Multi-Agent PACT Negotiation")
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--legal-token", default=os.environ.get("PACT_INVITE_TOKEN_LEGAL", ""))
    parser.add_argument("--commercial-token", default=os.environ.get("PACT_INVITE_TOKEN_COMMERCIAL", ""))
    args = parser.parse_args()

    if not args.legal_token or not args.commercial_token:
        print("Error: Provide invite tokens via args or environment variables", file=sys.stderr)
        sys.exit(1)

    run_negotiation(args.doc_id, args.legal_token, args.commercial_token)


if __name__ == "__main__":
    main()
