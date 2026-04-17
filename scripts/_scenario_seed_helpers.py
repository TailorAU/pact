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
                    industry: str, predicates: dict, tags: list[str] | None = None) -> str:
    """Create-or-return scenario by stable id. Returns the id."""
    cur.execute(
        """
        INSERT INTO scenarios (id, title, description, industry, predicates, tags)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          industry = EXCLUDED.industry,
          predicates = EXCLUDED.predicates,
          tags = EXCLUDED.tags,
          updated_at = now()
        """,
        (scenario_id, title, description, industry,
         json.dumps(predicates), tags or []),
    )
    return scenario_id


def topic_id_by_title_prefix(cur, prefix: str) -> str | None:
    cur.execute("SELECT id FROM topics WHERE title LIKE %s ORDER BY created_at ASC LIMIT 1",
                (prefix + "%",))
    row = cur.fetchone()
    return row[0] if row else None


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
