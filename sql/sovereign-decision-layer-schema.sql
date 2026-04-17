-- #1152 Round 1 — Sovereign decision layer schema
-- Idempotent: every statement uses IF NOT EXISTS, so the file is safe to re-run.
-- Applied via sites/source/scripts/apply_sovereign_decision_schema.py.

-- 1. Citation join (fixes the #1141 review finding on topic→legislation edge resolution)
CREATE TABLE IF NOT EXISTS topic_legislation_citations (
  id              TEXT PRIMARY KEY,
  topic_id        TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  legislation_id  TEXT NOT NULL,  -- FK not enforced: allows forward-referencing legislation_docs rows not yet ingested
  citation_text   TEXT NOT NULL,  -- preserves the prose from topics.source_ref
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (topic_id, legislation_id)
);
CREATE INDEX IF NOT EXISTS tlc_topic_idx ON topic_legislation_citations (topic_id);
CREATE INDEX IF NOT EXISTS tlc_legislation_idx ON topic_legislation_citations (legislation_id);

-- 2. Scenarios — predicate containers (not claims; no consensus lifecycle)
CREATE TABLE IF NOT EXISTS scenarios (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  industry    TEXT,
  predicates  JSONB NOT NULL,
  tags        TEXT[] DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenarios_industry_idx ON scenarios (industry);
CREATE INDEX IF NOT EXISTS scenarios_predicates_gin ON scenarios USING gin (predicates);

-- 3. scenario_applies_when — scenario → topic OR scenario → legislation, with predicate JSON
CREATE TABLE IF NOT EXISTS scenario_applies_when (
  id             TEXT PRIMARY KEY,
  scenario_id    TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  topic_id       TEXT REFERENCES topics(id) ON DELETE CASCADE,
  legislation_id TEXT,
  predicate      JSONB NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((topic_id IS NOT NULL) <> (legislation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS saw_scenario_idx ON scenario_applies_when (scenario_id);
CREATE INDEX IF NOT EXISTS saw_topic_idx ON scenario_applies_when (topic_id);
CREATE INDEX IF NOT EXISTS saw_legislation_idx ON scenario_applies_when (legislation_id);

-- 4. legislation_co_applies — scoped mutual-reinforcement edges
--    Either end may be a topic or a legislation doc; scope is a non-empty scenario_ids array.
CREATE TABLE IF NOT EXISTS legislation_co_applies (
  id                   TEXT PRIMARY KEY,
  left_topic_id        TEXT REFERENCES topics(id) ON DELETE CASCADE,
  left_legislation_id  TEXT,
  right_topic_id       TEXT REFERENCES topics(id) ON DELETE CASCADE,
  right_legislation_id TEXT,
  scenario_ids         TEXT[] NOT NULL,
  relationship         TEXT NOT NULL,
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((left_topic_id IS NOT NULL) <> (left_legislation_id IS NOT NULL)),
  CHECK ((right_topic_id IS NOT NULL) <> (right_legislation_id IS NOT NULL)),
  CHECK (array_length(scenario_ids, 1) >= 1)
);
CREATE INDEX IF NOT EXISTS co_applies_scenarios_gin ON legislation_co_applies USING gin (scenario_ids);

-- 5. agent_work_assignments — open / claimed / submitted work items
CREATE TABLE IF NOT EXISTS agent_work_assignments (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  work_type      TEXT NOT NULL,
  payload        JSONB NOT NULL,
  reward_credits INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  claimed_at     TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_agent_status_idx ON agent_work_assignments (agent_id, status);
CREATE INDEX IF NOT EXISTS work_status_expires_idx ON agent_work_assignments (status, expires_at);

-- 6. agent_work_ledger — what was accepted / rejected and what credits were awarded
CREATE TABLE IF NOT EXISTS agent_work_ledger (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  assignment_id   TEXT REFERENCES agent_work_assignments(id) ON DELETE SET NULL,
  submission      JSONB NOT NULL,
  validator_notes TEXT,
  accepted        BOOLEAN NOT NULL,
  credits_awarded INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_agent_idx ON agent_work_ledger (agent_id);

-- 7. #1160 Round 1 — scenario metadata: source_ref (statute-grade citation) + jurisdiction + review_count
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS jurisdiction TEXT;
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS scenarios_jurisdiction_idx ON scenarios (jurisdiction);

-- 8. #1160 Round 3 — applicability_spotcheck_defects (open findings awaiting human curation)
CREATE TABLE IF NOT EXISTS applicability_spotcheck_defects (
  id                TEXT PRIMARY KEY,
  scenario_id       TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  submitted_by      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  assignment_id     TEXT REFERENCES agent_work_assignments(id) ON DELETE SET NULL,
  finding_kind      TEXT NOT NULL,                         -- "reject" | "missing"
  edge_id           TEXT,
  target_kind       TEXT,                                  -- "topic" | "legislation"
  target_id         TEXT,
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',          -- open | accepted | dismissed
  resolved_by       TEXT,
  resolved_at       TIMESTAMPTZ,
  potential_credits INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS defects_scenario_idx ON applicability_spotcheck_defects (scenario_id);
CREATE INDEX IF NOT EXISTS defects_status_idx ON applicability_spotcheck_defects (status);

-- 9. #1160 Round 3 — match_request_log (lightweight ring buffer of real-world predicate queries)
CREATE TABLE IF NOT EXISTS match_request_log (
  id         TEXT PRIMARY KEY,
  predicates JSONB NOT NULL,
  agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_log_created_idx ON match_request_log (created_at DESC);
