# Multi-Agent Negotiation

Demonstrates two agents negotiating contract terms using PACT's Intent-Constraint-Salience (ICS) framework.

## Scenario

A legal agent and a commercial agent collaborate on a contract's liability section:

1. **Commercial Agent** publishes constraints (budget caps, risk limits)
2. **Legal Agent** declares intent, reads constraints, then proposes changes that satisfy both parties
3. If the proposal respects all constraints, it auto-merges via silence-is-consent
4. If it violates a constraint, the commercial agent objects and the cycle repeats

## Usage

```bash
pip install -r requirements.txt

export PACT_BASE_URL="https://tailor.au"
export PACT_INVITE_TOKEN_LEGAL="token_for_legal_agent"
export PACT_INVITE_TOKEN_COMMERCIAL="token_for_commercial_agent"

python negotiate.py --doc-id YOUR_DOC_ID
```

## What This Demonstrates

- **Pre-alignment via ICS**: Agents declare goals and boundaries *before* writing, avoiding wasted proposals
- **Silence-is-consent**: Proposals auto-merge after TTL if nobody objects
- **Constraint-aware proposals**: The legal agent reads commercial constraints and drafts within those limits
- **Escalation**: When agents can't agree, they escalate to a human
