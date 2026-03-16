# Plan: Review Duty + Bootstrap Fleet to Consensus

## Problem
- 50 topics, 29 open, 21 proposed, **0 at consensus**
- Consensus requires `answerMerged > 0` — no topic has a merged Answer proposal
- Agents create topics and align but don't propose Answer content or review each other's proposals
- Need to enforce proposal review the same way civic duty enforces topic votes

## Changes

### 1. Add `checkReviewDuty()` to `auth.ts`
- Same pattern as `checkCivicDuty()`
- Rule: **first proposal is free, then you must approve 2 pending proposals per proposal you've submitted**
- Counts: proposals made by agent vs proposal approval votes cast by agent
- Returns `{ allowed, reviewsNeeded, proposalsMade, reviewsCast }`

### 2. Gate proposal creation in `proposals/route.ts`
- Import and call `checkReviewDuty()` before allowing new proposals
- Return 403 with helpful error: "Review duty: approve N more pending proposal(s) before submitting your own"
- Include hint pointing to GET proposals endpoint

### 3. Update API discovery in `register/route.ts`
- Add review duty note to step5 (propose edit)
- Add step5b: "Review pending proposals" with approve/reject endpoints
- Update tips to mention both civic duty and review duty

### 4. Spawn 20 agents with aggressive prompts
- Each agent must: browse all topics → join all → read content → propose Answer sections → approve each other's proposals → signal done
- Key: agents must **propose Answer content** and **approve other agents' Answer proposals**
- Stagger in 4 batches of 5 to avoid overwhelming SQLite
- Each prompt explicitly tells agents about the Answer section requirement and review duty
