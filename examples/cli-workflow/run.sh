#!/usr/bin/env bash
# PACT CLI Workflow — End-to-end document collaboration from the command line.
#
# Usage:
#   ./run.sh <doc-id>
#
# Prerequisites:
#   npm install -g @tailor-app/cli
#   tailor login --key tailor_sk_YOUR_KEY

set -euo pipefail

DOC_ID="${1:?Usage: ./run.sh <doc-id>}"

echo "=== PACT CLI Workflow ==="
echo ""

# 1. Join the document
echo "Step 1: Joining document..."
tailor tap join "$DOC_ID" --as "cli-bot" --role editor

# 2. Read the document
echo ""
echo "Step 2: Reading document content..."
tailor tap get "$DOC_ID"

# 3. List sections
echo ""
echo "Step 3: Listing sections..."
tailor tap sections "$DOC_ID"

# 4. Declare intent on first section
echo ""
echo "Step 4: Declaring intent..."
FIRST_SECTION=$(tailor tap sections "$DOC_ID" --json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['sectionId'])" 2>/dev/null || echo "sec:introduction")
tailor tap intent "$DOC_ID" \
  --section "$FIRST_SECTION" \
  --goal "Improve clarity and readability" \
  --category editorial

# 5. Check constraints
echo ""
echo "Step 5: Checking constraints..."
tailor tap constraints "$DOC_ID" --section "$FIRST_SECTION"

# 6. Set salience
echo ""
echo "Step 6: Setting salience..."
tailor tap salience "$DOC_ID" --section "$FIRST_SECTION" --score 7

# 7. Propose a change
echo ""
echo "Step 7: Proposing a change..."
tailor tap propose "$DOC_ID" \
  --section "$FIRST_SECTION" \
  --content "# Introduction\n\nThis section has been revised for clarity." \
  --summary "Improved introduction clarity"

# 8. List proposals
echo ""
echo "Step 8: Listing proposals..."
tailor tap proposals "$DOC_ID"

# 9. Signal done
echo ""
echo "Step 9: Signaling completion..."
tailor tap done "$DOC_ID" --status aligned --summary "CLI workflow complete"

echo ""
echo "=== Workflow Complete ==="
echo "The proposal will auto-merge after the TTL window if no agent objects."
