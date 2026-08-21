from __future__ import annotations

import base64
import copy
import gzip
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from legislation_ingest_contract import compact_json_bytes, validate_payload, validate_workflow_inputs
from run_reviewed_legislation_ingest import HttpResponse


def raw_document() -> dict[str, Any]:
    return {
        "id": "qld/act-2016-025",
        "jurisdiction": "au-qld",
        "type": "ACT",
        "title": "Planning Act 2016",
        "shortTitle": None,
        "year": 2016,
        "number": "25",
        "inForceDate": "2017-07-03",
        "lastAmendedDate": "2026-04-27",
        "repealedDate": None,
        "administeredBy": "Department of State Development",
        "legislationUrl": "https://example.test/act",
        "sections": [
            {
                "sectionId": "s 2",
                "title": "Definitions",
                "content": "Meaning.",
                "depth": 3,
                "parentSection": "pt 1",
                "order": 2,
                "status": "IN_FORCE",
                "amendedBy": None,
                "crossReferences": ["s 3", "s 1"],
                "notes": "note",
            },
            {
                "sectionId": "s 1",
                "title": None,
                "content": "  exact\nbytes  ",
                "depth": 2,
                "parentSection": None,
                "order": 1,
                "status": "in_force",
                "amendedBy": None,
                "crossReferences": [],
                "notes": None,
            },
        ],
        "relatedDocs": ["qld/reg-b", "qld/reg-a"],
    }


def normalized_payload(document: dict[str, Any] | None = None) -> dict[str, Any]:
    payload, _ = validate_payload(
        {"documents": [copy.deepcopy(document or raw_document())]},
        require_explicit_relations=False,
    )
    return payload


def workflow_inputs(document: dict[str, Any] | None = None, *, terms: list[str] | None = None) -> dict[str, str]:
    payload = normalized_payload(document)
    raw = compact_json_bytes(payload)
    return {
        "builder_key": "reviewed",
        "diagnostic_terms_json": json.dumps(terms or [], separators=(",", ":")),
        "dispatch_id": "0123456789abcdef0123456789abcdef",
        "document_id": payload["documents"][0]["id"],
        "document_lock": hashlib.sha256(
            payload["documents"][0]["id"].encode("utf-8")
        ).hexdigest(),
        "expected_sections": str(len(payload["documents"][0]["sections"])),
        "last_amended_date": payload["documents"][0]["lastAmendedDate"],
        "payload_gzip_b64": base64.b64encode(gzip.compress(raw, mtime=0)).decode("ascii"),
    }


def reviewed(document: dict[str, Any] | None = None, *, terms: list[str] | None = None):
    return validate_workflow_inputs(workflow_inputs(document, terms=terms))


def canonical_response(reviewed_value, document: dict[str, Any] | None = None) -> HttpResponse:
    if document is None:
        candidate = copy.deepcopy(reviewed_value.document)
        candidate.setdefault("relatedDocs", [])
        normalized = normalized_payload(candidate)["documents"][0]
    else:
        normalized = normalized_payload(document)["documents"][0]
    from legislation_ingest_contract import document_payload_hash

    return json_response(
        200,
        {
            "document": normalized,
            "sectionCount": len(normalized["sections"]),
            "digestVersion": "legislation-payload-v1",
            "payloadHash": document_payload_hash(normalized),
        },
        headers={"cache-control": "no-store, max-age=0"},
    )


def not_found_response(document_id: str) -> HttpResponse:
    return json_response(
        404,
        {"error": "legislation_not_found", "id": document_id},
        headers={"cache-control": "no-store, max-age=0"},
    )


def post_success(reviewed_value) -> HttpResponse:
    return json_response(
        200,
        {
            "ingested": 1,
            "documents": [
                {
                    "id": reviewed_value.document_id,
                    "title": reviewed_value.document["title"],
                    "sectionsInserted": reviewed_value.expected_sections,
                }
            ],
            "message": "ok",
        },
    )


def json_response(status: int, value: Any, *, headers: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(status, headers or {}, compact_json_bytes(value))


class FakeTransport:
    def __init__(self, responses: list[HttpResponse | Exception]):
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def request(self, method, url, *, headers, body, timeout, response_cap):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "body": body,
                "timeout": timeout,
                "response_cap": response_cap,
            }
        )
        if not self.responses:
            raise AssertionError("fake transport response queue exhausted")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response
