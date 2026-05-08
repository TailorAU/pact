-- Legislation schema — WS8 extraction from db.ts
-- Idempotent: every statement uses IF NOT EXISTS, so the file is safe to re-run.
-- Applied at startup by initSchema() in sites/source/src/lib/db.ts.

-- ── Legislation Tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS legislation_docs (
  id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'act',
  title TEXT NOT NULL,
  short_title TEXT,
  year INTEGER,
  number TEXT,
  in_force_date TEXT,
  last_amended_date TEXT,
  repealed_date TEXT,
  administered_by TEXT,
  legislation_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legislation_sections (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES legislation_docs(id),
  topic_id TEXT REFERENCES topics(id),
  section_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 2,
  parent_section TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_force',
  amended_by TEXT,
  cross_references TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS legislation_relations (
  id TEXT PRIMARY KEY,
  from_doc_id TEXT NOT NULL REFERENCES legislation_docs(id),
  to_doc_id TEXT NOT NULL REFERENCES legislation_docs(id),
  relation_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_doc_id, to_doc_id, relation_type)
);

-- ── Legislation Sync Log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS legislation_sync_log (
  id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL,
  sync_type TEXT NOT NULL DEFAULT 'scheduled',
  docs_checked INTEGER NOT NULL DEFAULT 0,
  docs_updated INTEGER NOT NULL DEFAULT 0,
  sections_total INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_legdoc_jurisdiction ON legislation_docs(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_legdoc_type ON legislation_docs(doc_type);
CREATE INDEX IF NOT EXISTS idx_legsec_doc ON legislation_sections(doc_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_legsec_topic ON legislation_sections(topic_id);
CREATE INDEX IF NOT EXISTS idx_legsec_section_id ON legislation_sections(section_id);
CREATE INDEX IF NOT EXISTS idx_legsec_status ON legislation_sections(status);
