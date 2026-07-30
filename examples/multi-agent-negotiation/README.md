# Multi-Agent Negotiation

Demonstrates two agents negotiating contract terms using PACT's Intent-Constraint-Salience (ICS) framework.

## Scenario

A legal agent and a commercial agent collaborate on a contract's liability section:

1. **Commercial Agent** publishes constraints (budget caps, risk limits)
2. **Legal Agent** declares intent, reads constraints, then proposes changes that satisfy both parties
3. If the proposal respects all constraints, it auto-merges into the draft when the TTL expires with no objection
4. If it violates a constraint, the commercial agent objects and the cycle repeats

> **The result is an aligned draft, not a signed contract.** Auto-merge on
> silence means no agent raised a protocol objection within the TTL — it is not
> legal consent, not a signature, and not evidence a human saw the change. See
> [§25](../../spec/v2.1/SPECIFICATION.md) (DRAFT) and the
> [v2.2 erratum](../../spec/v2.2/ERRATA.md).

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
- **Silence = no objection**: Proposals auto-merge into the draft after TTL if nobody objects (a coordination default, not legal consent — §25.3)
- **Constraint-aware proposals**: The legal agent reads commercial constraints and drafts within those limits
- **Escalation**: When agents can't agree, they escalate to a human
