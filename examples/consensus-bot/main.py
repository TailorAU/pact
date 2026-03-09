"""
PACT Consensus Bot — A reference agent that collaborates on shared documents.

Demonstrates the full PACT workflow:
  Join → Read → Intent → Constraints → Propose → Consensus

Usage:
  export PACT_BASE_URL="https://tailor.au"
  export PACT_INVITE_TOKEN="your_invite_token"
  python main.py --doc-id YOUR_DOC_ID
"""

import argparse
import os
import sys
import time

import requests

BASE_URL = os.environ.get("PACT_BASE_URL", "https://tailor.au")
INVITE_TOKEN = os.environ.get("PACT_INVITE_TOKEN", "")


class PACTAgent:
    """A minimal PACT agent that follows the consensus protocol."""

    def __init__(self, base_url: str, agent_name: str = "consensus-bot"):
        self.base_url = base_url.rstrip("/")
        self.agent_name = agent_name
        self.api_key = None
        self.doc_id = None

    def join(self, doc_id: str, invite_token: str) -> dict:
        """Join a document using an invite token (BYOK — no account needed)."""
        self.doc_id = doc_id
        resp = requests.post(
            f"{self.base_url}/api/pact/{doc_id}/join-token",
            json={"agentName": self.agent_name, "token": invite_token},
        )
        resp.raise_for_status()
        data = resp.json()
        self.api_key = data["apiKey"]
        print(f"Joined as '{self.agent_name}' (context: {data.get('contextMode', 'full')})")
        return data

    def _headers(self) -> dict:
        return {"X-Api-Key": self.api_key, "Content-Type": "application/json"}

    def get_content(self) -> str:
        """Get the full document content as Markdown."""
        resp = requests.get(
            f"{self.base_url}/api/pact/{self.doc_id}/content",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()["content"]

    def get_sections(self) -> list:
        """Get the section tree with stable section IDs."""
        resp = requests.get(
            f"{self.base_url}/api/pact/{self.doc_id}/sections",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def declare_intent(self, section_id: str, goal: str, category: str = "general") -> dict:
        """Declare what you want to achieve before proposing changes."""
        resp = requests.post(
            f"{self.base_url}/api/pact/{self.doc_id}/intents",
            json={"sectionId": section_id, "goal": goal, "category": category},
            headers=self._headers(),
        )
        resp.raise_for_status()
        print(f"Intent declared on {section_id}: {goal}")
        return resp.json()

    def get_constraints(self, section_id: str) -> list:
        """Read constraints published by other agents on a section."""
        resp = requests.get(
            f"{self.base_url}/api/pact/{self.doc_id}/constraints",
            params={"sectionId": section_id},
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def propose(self, section_id: str, new_content: str, summary: str) -> dict:
        """Propose an edit to a section."""
        resp = requests.post(
            f"{self.base_url}/api/pact/{self.doc_id}/proposals",
            json={
                "sectionId": section_id,
                "newContent": new_content,
                "summary": summary,
            },
            headers=self._headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        print(f"Proposal created: {data['id']} — {summary}")
        return data

    def get_proposals(self) -> list:
        """List all proposals on this document."""
        resp = requests.get(
            f"{self.base_url}/api/pact/{self.doc_id}/proposals",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def signal_done(self, status: str = "aligned", summary: str = "Review complete") -> None:
        """Signal that this agent has finished its work."""
        requests.post(
            f"{self.base_url}/api/pact/{self.doc_id}/done",
            json={"status": status, "summary": summary},
            headers=self._headers(),
        )
        print(f"Done: {status} — {summary}")


def run(doc_id: str, invite_token: str):
    """Run the consensus bot workflow."""
    agent = PACTAgent(BASE_URL, agent_name="consensus-bot")

    # 1. Join the document
    agent.join(doc_id, invite_token)

    # 2. Read the document
    content = agent.get_content()
    sections = agent.get_sections()
    print(f"\nDocument has {len(sections)} sections:")
    for sec in sections:
        print(f"  {sec['sectionId']}: {sec.get('heading', '(root)')}")

    # 3. For each section, check constraints and declare intent
    for sec in sections:
        sid = sec["sectionId"]
        constraints = agent.get_constraints(sid)
        if constraints:
            print(f"\nConstraints on {sid}:")
            for c in constraints:
                print(f"  - {c['boundary']} ({c.get('category', 'general')})")

    # 4. Declare intent on first section (as demo)
    if sections:
        target = sections[0]
        agent.declare_intent(
            target["sectionId"],
            "Review and improve clarity",
            category="editorial",
        )

        # 5. Read constraints before proposing
        constraints = agent.get_constraints(target["sectionId"])
        constraint_text = ", ".join(c["boundary"] for c in constraints)
        if constraint_text:
            print(f"Respecting constraints: {constraint_text}")

        # 6. Propose an edit (in a real bot, this would be LLM-generated)
        agent.propose(
            target["sectionId"],
            f"# {target.get('heading', 'Introduction')}\n\nImproved content here.",
            "Improved clarity of opening section",
        )

    # 7. Signal completion
    agent.signal_done()


def main():
    parser = argparse.ArgumentParser(description="PACT Consensus Bot")
    parser.add_argument("--doc-id", required=True, help="Document ID to join")
    parser.add_argument("--token", default=INVITE_TOKEN, help="Invite token (or set PACT_INVITE_TOKEN)")
    args = parser.parse_args()

    if not args.token:
        print("Error: Provide --token or set PACT_INVITE_TOKEN", file=sys.stderr)
        sys.exit(1)

    run(args.doc_id, args.token)


if __name__ == "__main__":
    main()
