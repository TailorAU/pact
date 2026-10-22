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


# -----------------------------------------------------------------------------
# #1160 Round 6.1 — scenario_revisions helpers
# -----------------------------------------------------------------------------
# Every mutation to a scenario or its edges must leave a trail in
# scenario_revisions. These helpers read env vars so scripts can set them once
# at the top (see Round 7 PowerShell block in the handoff §12):
#
#   $env:SCENARIO_CHANGE_TRIGGER = "T10"        # trigger code from §11.2
#   $env:SCENARIO_CHANGE_ACTOR   = "seed-1160"  # human email or seed script tag
#
# Seeders running on dev without the env set default to T10/seed-local so local
# runs still leave an audit trail (noisy but correct).

def _trigger_defaults() -> tuple[str, str, str | None]:
    return (
        os.environ.get("SCENARIO_CHANGE_TRIGGER", "T10"),
        os.environ.get("SCENARIO_CHANGE_ACTOR", "seed-local"),
        os.environ.get("SCENARIO_CHANGE_DETAIL"),
    )


def _fetch_scenario_row(cur, scenario_id: str) -> dict | None:
    cur.execute(
        """SELECT id, title, description, industry, predicates, tags,
                  source_ref, jurisdiction, review_count,
                  created_at, updated_at
           FROM scenarios WHERE id = %s""",
        (scenario_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0], "title": row[1], "description": row[2], "industry": row[3],
        "predicates": row[4], "tags": row[5] or [],
        "source_ref": row[6], "jurisdiction": row[7],
        "review_count": row[8],
        "created_at": row[9].isoformat() if row[9] else None,
        "updated_at": row[10].isoformat() if row[10] else None,
    }


def record_revision(cur, scenario_id: str, *, revision_kind: str,
                    before_state: dict | None, after_state: dict,
                    edges_delta: dict | None = None,
                    trigger_code: str | None = None,
                    trigger_detail: str | None = None,
                    changed_by: str | None = None,
                    commit_sha: str | None = None) -> str:
    """Append one scenario_revisions row. Idempotent via deterministic id.

    Re-running the same seed script should not proliferate revisions: the id is
    sha256(scenario_id|revision_kind|json(after_state)|trigger_code|changed_by)
    so a no-op re-run collides on PK and gets skipped.
    """
    t_code, t_actor, t_detail = _trigger_defaults()
    trigger_code = trigger_code or t_code
    changed_by = changed_by or t_actor
    trigger_detail = trigger_detail or t_detail
    rev_id = _sid(
        "rev",
        scenario_id, revision_kind,
        json.dumps(after_state, sort_keys=True, default=str),
        trigger_code, changed_by,
    )
    cur.execute(
        """
        INSERT INTO scenario_revisions
          (id, scenario_id, revision_kind, trigger_code, trigger_detail,
           before_state, after_state, edges_delta, changed_by, commit_sha)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            rev_id, scenario_id, revision_kind, trigger_code, trigger_detail,
            json.dumps(before_state, default=str) if before_state is not None else None,
            json.dumps(after_state, default=str),
            json.dumps(edges_delta, default=str) if edges_delta is not None else None,
            changed_by, commit_sha,
        ),
    )
    return rev_id


def upsert_scenario(cur, scenario_id: str, title: str, description: str,
                    industry: str, predicates: dict, tags: list[str] | None = None,
                    *, source_ref: str | None = None,
                    jurisdiction: str | None = None,
                    trigger_code: str | None = None,
                    trigger_detail: str | None = None,
                    changed_by: str | None = None) -> str:
    """Create-or-return scenario by stable id. Returns the id.

    source_ref + jurisdiction are #1160 Round 1 additions. They are upserted
    non-destructively: if the caller omits them but a row already has a
    value, the existing value is preserved (via COALESCE on the new column).

    #1160 Round 6.1: also records a `scenario_revisions` row on create /
    material update. No-op re-runs (same after_state) collide on the
    revision PK and don't bloat the audit log.
    """
    before_state = _fetch_scenario_row(cur, scenario_id)
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
    after_state = _fetch_scenario_row(cur, scenario_id) or {"id": scenario_id}
    # Emit revision if the row is new OR the mutable fields changed.
    if before_state is None:
        record_revision(cur, scenario_id, revision_kind="create",
                        before_state=None, after_state=after_state,
                        trigger_code=trigger_code, trigger_detail=trigger_detail,
                        changed_by=changed_by)
    else:
        material = ("title", "description", "industry", "predicates",
                    "tags", "source_ref", "jurisdiction")
        if any(before_state.get(k) != after_state.get(k) for k in material):
            record_revision(cur, scenario_id, revision_kind="update",
                            before_state=before_state, after_state=after_state,
                            trigger_code=trigger_code, trigger_detail=trigger_detail,
                            changed_by=changed_by)
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
                     predicate: dict | None = None, note: str = "",
                     trigger_code: str | None = None,
                     trigger_detail: str | None = None,
                     changed_by: str | None = None) -> bool:
    """Insert a scenario_applies_when edge. Returns True if newly inserted.

    #1160 Round 6.1: on successful insert we emit an `edge_add` revision
    on the parent scenario so the audit trail captures edge topology.
    """
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
    inserted = cur.rowcount == 1
    if inserted:
        scn_after = _fetch_scenario_row(cur, scenario_id) or {"id": scenario_id}
        record_revision(
            cur, scenario_id, revision_kind="edge_add",
            before_state=None, after_state=scn_after,
            edges_delta={
                "added": [{
                    "edge_id": edge_id,
                    "topic_id": topic_id,
                    "legislation_id": legislation_id,
                    "predicate": predicate or {},
                    "note": note,
                }],
                "removed": [],
            },
            trigger_code=trigger_code, trigger_detail=trigger_detail,
            changed_by=changed_by,
        )
    return inserted


def add_co_applies(cur, *, scenario_ids: list[str], relationship: str,
                   left_topic_id: str | None = None,
                   left_legislation_id: str | None = None,
                   right_topic_id: str | None = None,
                   right_legislation_id: str | None = None,
                   note: str = "",
                   trigger_code: str | None = None,
                   trigger_detail: str | None = None,
                   changed_by: str | None = None) -> bool:
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
    inserted = cur.rowcount == 1
    if inserted:
        delta = {
            "added": [{
                "edge_id": edge_id,
                "kind": "co_applies",
                "relationship": relationship,
                "left_topic_id": left_topic_id,
                "left_legislation_id": left_legislation_id,
                "right_topic_id": right_topic_id,
                "right_legislation_id": right_legislation_id,
                "note": note,
            }],
            "removed": [],
        }
        for scn_id in scenario_ids:
            scn_after = _fetch_scenario_row(cur, scn_id)
            if scn_after is None:
                continue
            record_revision(
                cur, scn_id, revision_kind="edge_add",
                before_state=None, after_state=scn_after,
                edges_delta=delta,
                trigger_code=trigger_code,
                trigger_detail=trigger_detail,
                changed_by=changed_by,
            )
    return inserted


def summarise(label: str, created: int, total: int) -> None:
    print(f"  {label}: {created} new / {total - created} already existed / {total} total")


def run_scenario_seed(scenarios: list[dict], *,
                      stub_jurisdiction: str = "AU",
                      stub_authority: str | None = None) -> int:
    """#1160 — Shared runner used by every `seed_scenarios_*.py` script.

    Each scenario dict supports:
      - id, title, description, industry, predicates, tags  (required)
      - jurisdiction, source_ref                             (optional — scenarios.* cols)
      - topic_stubs: list of {title, canonical_claim?, source_ref?, predicate?, note?}
            → upsert_topic_stub(...) + add_applies_when(topic_id=...)
      - topic_prefixes: list of (title_prefix, predicate, note)
            → topic_id_by_title_prefix + add_applies_when(topic_id=...)
      - legislation_links: list of (legislation_id, predicate, note)
            → add_applies_when(legislation_id=...)

    stub_jurisdiction + stub_authority feed through to upsert_topic_stub for
    stubs that don't override them — keeps seed scripts terse.
    """
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                created_scenarios = 0
                created_edges = 0
                total_edges = 0
                for scn in scenarios:
                    cur.execute("SELECT 1 FROM scenarios WHERE id = %s", (scn["id"],))
                    existed_before = cur.fetchone() is not None
                    upsert_scenario(
                        cur, scn["id"], scn["title"], scn["description"],
                        scn["industry"], scn["predicates"], scn.get("tags", []),
                        source_ref=scn.get("source_ref"),
                        jurisdiction=scn.get("jurisdiction"),
                    )
                    if not existed_before:
                        created_scenarios += 1
                        print(f"  CREATED scenario {scn['id']}")
                    else:
                        print(f"  UPDATED scenario {scn['id']}")
                    for stub in scn.get("topic_stubs", []):
                        topic_id = upsert_topic_stub(
                            cur,
                            title=stub["title"],
                            tier=stub.get("tier", "institutional"),
                            jurisdiction=stub.get("jurisdiction", stub_jurisdiction),
                            authority=stub.get("authority", stub_authority),
                            canonical_claim=stub.get("canonical_claim"),
                            source_ref=stub.get("source_ref"),
                        )
                        total_edges += 1
                        if add_applies_when(
                            cur, scn["id"], topic_id=topic_id,
                            predicate=stub.get("predicate") or {"required": True},
                            note=stub.get("note", ""),
                        ):
                            created_edges += 1
                    for prefix, predicate, note in scn.get("topic_prefixes", []):
                        topic_id = topic_id_by_title_prefix(cur, prefix)
                        total_edges += 1
                        if not topic_id:
                            print(f"    SKIP (no topic): '{prefix[:60]}...'")
                            continue
                        if add_applies_when(cur, scn["id"], topic_id=topic_id,
                                            predicate=predicate, note=note):
                            created_edges += 1
                    for leg_id, predicate, note in scn.get("legislation_links", []):
                        total_edges += 1
                        if add_applies_when(cur, scn["id"], legislation_id=leg_id,
                                            predicate=predicate, note=note):
                            created_edges += 1
                print()
                summarise("Scenarios", created_scenarios, len(scenarios))
                summarise("Applies-when edges", created_edges, total_edges)
    finally:
        conn.close()
    return 0
