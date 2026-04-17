"""#1152 Round 2 — shared helpers for scenario + edge seed scripts.

Scenarios are predicate containers, not PACT claims (no consensus lifecycle).
This module writes directly to Postgres via $DATABASE_URL, the same way
apply_sovereign_decision_schema.py does. Round 3a's POST /api/scenarios
endpoint can co-exist with these writes — both use idempotent ON CONFLICT.

Idempotency model:
* scenarios.id, scenario_applies_when.id, legislation_co_applies.id are all
  deterministic (sha256 of stable inputs). Re-running any seed script
  produces zero new rows and zero updates.
* topic lookups go by exact title match against the #1137 seeds.
* legislation_id is stored as free text; the #1152 schema deliberately
  does NOT enforce an FK on legislation_docs(id) so forward references
  (pre-eCFR US instruments like 22 CFR 120) survive.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from typing import Any, Iterable

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 required. Install: pip install psycopg2-binary")
    sys.exit(2)


def _require_db() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set. See handoff Section 8 for prod URL.")
        sys.exit(1)
    return url


def connect():
    return psycopg2.connect(_require_db())


def _sid(prefix: str, *parts: Any) -> str:
    """Deterministic short id — sha256 over ('|'-joined parts)."""
    blob = "|".join(str(p) for p in parts).encode("utf-8")
    return f"{prefix}:{hashlib.sha256(blob).hexdigest()[:16]}"


def upsert_scenario(cur, scenario_id: str, title: str, description: str,
                    industry: str, predicates: dict, tags: list[str] | None = None,
                    *, source_ref: str | None = None,
                    jurisdiction: str | None = None) -> str:
    """Create-or-return scenario by stable id. Returns the id.

    source_ref + jurisdiction are #1160 Round 1 additions. They are upserted
    non-destructively: if the caller omits them but a row already has a
    value, the existing value is preserved (via COALESCE on the new column).
    """
    cur.execute(
        """
        INSERT INTO scenarios
          (id, title, description, industry, predicates, tags, source_ref, jurisdiction)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          industry = EXCLUDED.industry,
          predicates = EXCLUDED.predicates,
          tags = EXCLUDED.tags,
          source_ref   = COALESCE(EXCLUDED.source_ref,   scenarios.source_ref),
          jurisdiction = COALESCE(EXCLUDED.jurisdiction, scenarios.jurisdiction),
          updated_at = now()
        """,
        (scenario_id, title, description, industry,
         json.dumps(predicates), tags or [], source_ref, jurisdiction),
    )
    return scenario_id


def topic_id_by_title_prefix(cur, prefix: str) -> str | None:
    cur.execute("SELECT id FROM topics WHERE title LIKE %s ORDER BY created_at ASC LIMIT 1",
                (prefix + "%",))
    row = cur.fetchone()
    return row[0] if row else None


def upsert_topic_stub(cur, *, title: str, tier: str = "institutional",
                      jurisdiction: str | None = None,
                      authority: str | None = None,
                      content: str | None = None,
                      canonical_claim: str | None = None,
                      source_ref: str | None = None) -> str:
    """#1160 helper — create-or-return a minimal topic stub by deterministic id.

    Used by scenario seed scripts when an `applies_when` edge needs to point
    at a topic that does not yet exist in the graph. Stubs land with
    `status = 'stub'` so PACT consensus flow can still promote them later
    into the consensus lifecycle. Richer authoring is expected via a follow-on
    PACT topic proposal; the seed comment should note this.

    Id shape: `topic:stub:{sha16}` where sha16 is the first 16 hex chars of
    sha256(title|tier|jurisdiction). Re-runs are idempotent.
    """
    stub_id = _sid("topic:stub", title, tier, jurisdiction or "-")
    stub_content = content or canonical_claim or source_ref or title
    cur.execute(
        """
        INSERT INTO topics (id, title, content, tier, status,
                            jurisdiction, authority, canonical_claim, source_ref)
        VALUES (%s, %s, %s, %s, 'stub', %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          content = COALESCE(NULLIF(EXCLUDED.content, ''), topics.content),
          jurisdiction = COALESCE(EXCLUDED.jurisdiction, topics.jurisdiction),
          authority = COALESCE(EXCLUDED.authority, topics.authority),
          canonical_claim = COALESCE(EXCLUDED.canonical_claim, topics.canonical_claim),
          source_ref = COALESCE(EXCLUDED.source_ref, topics.source_ref)
        """,
        (stub_id, title, stub_content, tier, jurisdiction, authority,
         canonical_claim, source_ref),
    )
    return stub_id


def add_applies_when(cur, scenario_id: str, *, topic_id: str | None = None,
                     legislation_id: str | None = None,
                     predicate: dict | None = None, note: str = "") -> bool:
    """Insert a scenario_applies_when edge. Returns True if newly inserted."""
    if (topic_id is None) == (legislation_id is None):
        raise ValueError("Exactly one of topic_id / legislation_id must be set")
    edge_id = _sid("saw", scenario_id, topic_id or "-", legislation_id or "-")
    cur.execute(
        """
        INSERT INTO scenario_applies_when
          (id, scenario_id, topic_id, legislation_id, predicate, note)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (edge_id, scenario_id, topic_id, legislation_id,
         json.dumps(predicate or {}), note),
    )
    return cur.rowcount == 1


def add_co_applies(cur, *, scenario_ids: list[str], relationship: str,
                   left_topic_id: str | None = None,
                   left_legislation_id: str | None = None,
                   right_topic_id: str | None = None,
                   right_legislation_id: str | None = None,
                   note: str = "") -> bool:
    """Insert a legislation_co_applies edge. Returns True if newly inserted."""
    if (left_topic_id is None) == (left_legislation_id is None):
        raise ValueError("Left side: exactly one of topic/legislation must be set")
    if (right_topic_id is None) == (right_legislation_id is None):
        raise ValueError("Right side: exactly one of topic/legislation must be set")
    if not scenario_ids:
        raise ValueError("scenario_ids must have at least one entry")
    edge_id = _sid(
        "cap",
        sorted(scenario_ids),
        left_topic_id or "-", left_legislation_id or "-",
        right_topic_id or "-", right_legislation_id or "-",
    )
    cur.execute(
        """
        INSERT INTO legislation_co_applies
          (id, left_topic_id, left_legislation_id,
           right_topic_id, right_legislation_id,
           scenario_ids, relationship, note)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (edge_id, left_topic_id, left_legislation_id,
         right_topic_id, right_legislation_id,
         scenario_ids, relationship, note),
    )
    return cur.rowcount == 1


def summarise(label: str, created: int, total: int) -> None:
    print(f"  {label}: {created} new / {total - created} already existed / {total} total")
