-- Curriculum schema — authoritative Australian curriculum graph (#2520)
-- Idempotent: every statement uses IF NOT EXISTS, so the file is safe to re-run.
-- Applied at startup by initSchema() in sites/source/src/lib/db.ts, exactly the
-- same pattern as legislation-schema.sql (WS8). The Dockerfile copies sql/ into
-- the runtime image so fs.readFileSync resolves at boot.
--
-- Shape mirrors the legislation graph: a framework (the "doc" analog — ACARA
-- v9, EYLF v2.0) holds many descriptors (the "section" analog — each carrying a
-- real authoritative code, the verbatim descriptor text as its claim, and a
-- source_ref back to the public government framework). Curriculum is
-- authoritative by definition (it comes from ACARA / the Education Ministers,
-- not from debate), so — like legislation — it bypasses the PACT consensus flow
-- and is ingested directly + served free/unauthenticated.

-- ── Curriculum Frameworks ───────────────────────────────────────────────────
-- One row per authoritative framework. e.g. ACARA v9 (F-10 + senior), EYLF v2.0.

CREATE TABLE IF NOT EXISTS curriculum_frameworks (
  id TEXT PRIMARY KEY,                  -- canonical id, e.g. "acara-v9", "eylf-v2"
  name TEXT NOT NULL,                   -- "Australian Curriculum v9.0"
  short_name TEXT,                      -- "ACARA v9"
  authority TEXT,                       -- "Australian Curriculum, Assessment and Reporting Authority (ACARA)"
  jurisdiction TEXT NOT NULL DEFAULT 'AU',
  version TEXT,                         -- "9.0", "2.0"
  framework_url TEXT,                   -- public landing page
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Curriculum Descriptors ──────────────────────────────────────────────────
-- One row per content descriptor / learning outcome. `code` is the real
-- authoritative identifier (ACARA: AC9E3LE05; EYLF: EYLF-LO1). `descriptor` is
-- the verbatim public text. `level` is the schooling band the PLG resolves by
-- (e.g. "F", "3", "6", "EL"). `subject` maps to the PLG SubjectKind. `source_ref`
-- cites the public framework document the text was taken from.

CREATE TABLE IF NOT EXISTS curriculum_descriptors (
  id TEXT PRIMARY KEY,                  -- "{framework_id}/{code}"
  framework_id TEXT NOT NULL REFERENCES curriculum_frameworks(id),
  code TEXT NOT NULL,                   -- "AC9E3LE05" | "EYLF-LO1"
  level TEXT NOT NULL,                  -- "F" | "1".."10" | "EL" (early learning / EYLF)
  level_name TEXT,                      -- "Foundation" | "Year 3" | "Early Learning (EYLF)"
  subject TEXT NOT NULL,                -- "English" | "Maths" | "Play" | ... (PLG SubjectKind)
  learning_area TEXT,                   -- "English" | "Mathematics" | "Belonging, Being & Becoming"
  strand TEXT,                          -- "Literature" | "Number" | "Outcome 4: Confident learners"
  title TEXT,                           -- short human label for the PLG topic tile
  descriptor TEXT NOT NULL,            -- verbatim content-descriptor / outcome text
  blurb TEXT,                           -- short plain-language gloss for the PLG tile
  source_ref TEXT,                      -- citation, e.g. "ACARA Australian Curriculum v9.0, English, Year 3"
  source_url TEXT,                      -- deep link where available
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(framework_id, code)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- The PLG read path filters by (level) and optionally (subject); index both.

CREATE INDEX IF NOT EXISTS idx_curric_desc_level ON curriculum_descriptors(level);
CREATE INDEX IF NOT EXISTS idx_curric_desc_level_subject ON curriculum_descriptors(level, subject);
CREATE INDEX IF NOT EXISTS idx_curric_desc_framework ON curriculum_descriptors(framework_id);
CREATE INDEX IF NOT EXISTS idx_curric_desc_code ON curriculum_descriptors(code);
