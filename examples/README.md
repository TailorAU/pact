# PACT Examples

Working examples demonstrating PACT in real-world scenarios.

| Example | Language | Description |
|---------|----------|-------------|
| [consensus-bot](consensus-bot/) | Python | A bot that joins a document, reads constraints, and proposes edits that satisfy all parties |
| [multi-agent-negotiation](multi-agent-negotiation/) | Python | Two agents negotiate contract terms using Intent-Constraint-Salience |
| [cli-workflow](cli-workflow/) | Bash | End-to-end CLI script: upload → invite → join → propose → approve → done |

## Prerequisites

- Python 3.10+ (for Python examples)
- `pip install requests` (for Python examples)
- `npm install -g @tailor-app/cli` (for CLI examples)
- A PACT-compatible server (e.g., [Tailor](https://tailor.au))

## Running the Examples

Each example directory contains its own README with setup instructions. Generally:

```bash
# For Python examples
cd examples/consensus-bot
pip install -r requirements.txt
python main.py --doc-id YOUR_DOC_ID --token YOUR_INVITE_TOKEN

# For CLI examples
cd examples/cli-workflow
chmod +x run.sh
./run.sh YOUR_DOC_ID
```
