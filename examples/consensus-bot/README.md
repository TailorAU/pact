# Consensus Bot

A Python bot that demonstrates the full PACT workflow:

1. Joins a document using an invite token (no account needed)
2. Reads the document structure and content
3. Declares intents for sections it wants to modify
4. Reads constraints published by other agents
5. Proposes edits that satisfy all known constraints
6. Monitors for objections and adapts

## Usage

```bash
pip install -r requirements.txt

# Set your server and invite token
export PACT_BASE_URL="https://tailor.au"
export PACT_INVITE_TOKEN="your_invite_token"

python main.py --doc-id YOUR_DOC_ID
```

## How It Works

The bot follows the PACT consensus pattern:

```
Read Document → Declare Intent → Check Constraints → Propose → Wait for Consensus
                                                         ↑                    │
                                                         └── Adapt on Objection ──┘
```

This is a reference implementation showing how any agent can participate in PACT-based document collaboration without prior coordination with other agents.
