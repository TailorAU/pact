#!/usr/bin/env python3
"""Shared validation and hashing for reviewed one-document legislation ingest.

This module deliberately uses only the Python standard library so the same
checks run in the local dispatcher and on a clean GitHub-hosted runner.
"""

from __future__ import annotations

import base64
import binascii
import datetime as dt
import gzip
import hashlib
import ipaddress
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit


DIGEST_VERSION = "legislation-payload-v1"
MAX_DISPATCH_INPUT_BYTES = 60_000
MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024
MAX_EVENT_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_SECTIONS = 10_000
MAX_DIAGNOSTIC_TERMS = 10
MAX_RELATED_DOCUMENTS = 2_000
MAX_CROSS_REFERENCES = 500
MAX_POSTGRES_INTEGER = 2_147_483_647
MAX_DOCUMENT_ID_CHARS = 256
MAX_JURISDICTION_CHARS = 32
MAX_TITLE_CHARS = 2_000
MAX_METADATA_CHARS = 2_000
MAX_URL_CHARS = 2_048
MAX_SECTION_ID_CHARS = 512
MAX_SECTION_TEXT_CHARS = 2_000
MAX_SECTION_CONTENT_CHARS = 2 * 1024 * 1024
MAX_SECTION_NOTES_CHARS = 64 * 1024

WORKFLOW_INPUT_KEYS = frozenset(
    {
        "builder_key",
        "diagnostic_terms_json",
        "dispatch_id",
        "document_id",
        "document_lock",
        "expected_sections",
        "last_amended_date",
        "payload_gzip_b64",
    }
)
DOCUMENT_KEYS = frozenset(
    {
        "administeredBy",
        "id",
        "inForceDate",
        "jurisdiction",
        "lastAmendedDate",
        "legislationUrl",
        "number",
        "relatedDocs",
        "repealedDate",
        "sections",
        "shortTitle",
        "title",
        "type",
        "year",
    }
)
SECTION_KEYS = frozenset(
    {
        "amendedBy",
        "content",
        "crossReferences",
        "depth",
        "notes",
        "order",
        "parentSection",
        "sectionId",
        "status",
        "title",
    }
)
DOCUMENT_TYPES = frozenset(
    {"act", "guidance", "local_law", "planning_scheme", "regulation", "standard"}
)
SECTION_STATUSES = frozenset({"in_force", "not_yet_commenced", "repealed"})

_JURISDICTION = re.compile(r"^[A-Z][A-Z0-9-]*$")
_BUILDER_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_DISPATCH_ID = re.compile(r"^[0-9a-f]{32}$")
_EXPECTED_SECTIONS = re.compile(r"^[1-9][0-9]{0,4}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_ASCII_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

# ECMAScript String.prototype.trim whitespace and line terminators. Python's
# str.strip() also removes a few C0/C1 separators that JavaScript preserves,
# which would otherwise make the runner normalize differently from Source.
_JS_TRIM_CHARACTERS = (
    "\u0009\u000b\u000c\u0020\u00a0\ufeff"
    "\u000a\u000d\u2028\u2029"
    "\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u202f\u205f\u3000"
)


class ValidationError(ValueError):
    """A safe validation error that never includes payload content."""


@dataclass(frozen=True)
class ReviewedIngest:
    builder_key: str
    document_id: str
    expected_sections: int
    last_amended_date: str
    diagnostic_terms: tuple[str, ...]
    dispatch_id: str
    document: dict[str, Any]
    payload: dict[str, Any]
    payload_bytes: bytes
    review_hash: str
    related_docs_explicit: bool
    dispatch_input_bytes: int
    decompressed_bytes: int


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError("JSON contains a duplicate object key")
        result[key] = value
    return result


def _reject_json_constant(_value: str) -> None:
    raise ValidationError("JSON contains a non-finite number")


def parse_json_bytes(raw: bytes, *, label: str) -> Any:
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ValidationError(f"{label} is not valid UTF-8") from error
    try:
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except ValidationError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as error:
        raise ValidationError(f"{label} is not valid JSON") from error


def compact_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8", errors="strict")
    except (TypeError, ValueError, UnicodeEncodeError, RecursionError) as error:
        raise ValidationError("value is not canonically JSON serializable") from error


def serialized_inputs_size(inputs: Mapping[str, Any]) -> int:
    try:
        size = len(compact_json_bytes(dict(inputs)))
    except ValidationError as error:
        raise ValidationError("workflow inputs are not serializable") from error
    if size > MAX_DISPATCH_INPUT_BYTES:
        raise ValidationError(
            f"serialized workflow inputs exceed {MAX_DISPATCH_INPUT_BYTES} bytes"
        )
    return size


def decode_payload_gzip_b64(encoded: Any) -> bytes:
    if not isinstance(encoded, str) or not encoded:
        raise ValidationError("payload_gzip_b64 must be a non-empty string")
    try:
        encoded_ascii = encoded.encode("ascii", errors="strict")
        compressed = base64.b64decode(encoded_ascii, validate=True)
    except (UnicodeEncodeError, binascii.Error, ValueError) as error:
        raise ValidationError("payload_gzip_b64 is not strict base64") from error
    if not compressed:
        raise ValidationError("payload_gzip_b64 decodes to an empty value")

    output = bytearray()
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
            while True:
                remaining = MAX_DECOMPRESSED_BYTES + 1 - len(output)
                if remaining <= 0:
                    raise ValidationError(
                        f"decompressed payload exceeds {MAX_DECOMPRESSED_BYTES} bytes"
                    )
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > MAX_DECOMPRESSED_BYTES:
                    raise ValidationError(
                        f"decompressed payload exceeds {MAX_DECOMPRESSED_BYTES} bytes"
                    )
    except ValidationError:
        raise
    except (EOFError, OSError) as error:
        raise ValidationError("payload_gzip_b64 is not a valid gzip stream") from error
    return bytes(output)


def _js_trim(value: str) -> str:
    return value.strip(_JS_TRIM_CHARACTERS)


def _js_length(value: str) -> int:
    """Return JavaScript String.length (UTF-16 code units)."""

    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def _required_trimmed_string(
    value: Any,
    *,
    field: str,
    max_length: int,
    identifier: bool = False,
) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a non-empty string")
    normalized = _js_trim(value)
    if not normalized:
        raise ValidationError(f"{field} must be a non-empty string")
    if _js_length(normalized) > max_length:
        raise ValidationError(f"{field} exceeds {max_length} characters")
    if identifier and _ASCII_CONTROL.search(normalized):
        raise ValidationError(f"{field} contains a control character")
    return normalized


def _nullable_string(value: Any, *, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string or null")
    normalized = _js_trim(value)
    if not normalized:
        return None
    if _js_length(normalized) > max_length:
        raise ValidationError(f"{field} exceeds {max_length} characters")
    return normalized


def _normalized_integer(
    value: Any,
    *,
    field: str,
    minimum: int,
    maximum: int,
) -> int:
    # JSON.parse has one Number type, so values such as 2.0 satisfy
    # Number.isInteger and are serialized by Source as 2.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(
            f"{field} must be an integer from {minimum} to {maximum}"
        )
    if isinstance(value, float) and not value.is_integer():
        raise ValidationError(
            f"{field} must be an integer from {minimum} to {maximum}"
        )
    normalized = int(value)
    if not minimum <= normalized <= maximum:
        raise ValidationError(
            f"{field} must be an integer from {minimum} to {maximum}"
        )
    return normalized


def _section_content(value: Any, *, index: int) -> str:
    field = f"document.sections[{index}].content"
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string")
    if _js_length(value) > MAX_SECTION_CONTENT_CHARS:
        raise ValidationError(
            f"{field} exceeds {MAX_SECTION_CONTENT_CHARS} characters"
        )
    return value


def validate_document_id(value: Any, *, field: str = "document id") -> str:
    return _required_trimmed_string(
        value,
        field=field,
        max_length=MAX_DOCUMENT_ID_CHARS,
        identifier=True,
    )


def validate_iso_date(value: Any, *, field: str, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if nullable and isinstance(value, str) and not _js_trim(value):
        return None
    value = _required_trimmed_string(value, field=field, max_length=10)
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError as error:
        raise ValidationError(f"{field} must be a real YYYY-MM-DD date") from error
    if parsed.isoformat() != value:
        raise ValidationError(f"{field} must be a real YYYY-MM-DD date")
    return value


def _validate_url(value: Any) -> str | None:
    if value is None:
        return None
    value = _nullable_string(
        value,
        field="document.legislationUrl",
        max_length=MAX_URL_CHARS,
    )
    if value is None:
        return None

    # Python's RFC-oriented urlsplit and Source's WHATWG URL constructor do
    # not accept the same language. The unattended runner deliberately admits
    # a conservative, dependency-free subset: every accepted value must also
    # be accepted by Source, while some unusual WHATWG-valid values are
    # rejected. Reviewed legislation builders use ordinary absolute URLs.
    prefix = re.match(r"https?://", value, flags=re.IGNORECASE)
    if (
        prefix is None
        or "\\" in value
        or any(
            character.isspace()
            or ord(character) < 0x20
            or ord(character) == 0x7F
            for character in value
        )
    ):
        raise ValidationError(
            "document.legislationUrl must be an unambiguous http(s) URL "
            "without credentials"
        )

    authority = re.split(r"[/\?#]", value[prefix.end() :], maxsplit=1)[0]
    if not authority or "@" in authority or authority.endswith(":"):
        raise ValidationError(
            "document.legislationUrl must be an unambiguous http(s) URL "
            "without credentials"
        )

    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError as error:
        raise ValidationError(
            "document.legislationUrl must be an unambiguous http(s) URL "
            "without credentials"
        ) from error

    if (
        parsed.scheme not in {"http", "https"}
        or parsed.netloc != authority
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or not parsed.hostname.isascii()
    ):
        raise ValidationError(
            "document.legislationUrl must be an unambiguous http(s) URL "
            "without credentials"
        )

    hostname = parsed.hostname
    try:
        if authority.startswith("["):
            closing_bracket = authority.find("]")
            if (
                "%" in hostname
                or closing_bracket < 0
                or authority[closing_bracket + 1 :] not in {"", f":{parsed.port}"}
            ):
                raise ValueError("ambiguous IPv6 authority")
            ipaddress.IPv6Address(hostname)
        elif re.fullmatch(r"[0-9.]+", hostname):
            if str(ipaddress.IPv4Address(hostname)) != hostname:
                raise ValueError("non-canonical IPv4 address")
        else:
            labels = hostname.split(".")
            if (
                len(hostname) > 253
                or not re.search(r"[A-Za-z]", labels[-1])
                or any(
                    re.fullmatch(
                        r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?",
                        label,
                    )
                    is None
                    for label in labels
                )
            ):
                raise ValueError("invalid DNS hostname")
    except ValueError as error:
        raise ValidationError(
            "document.legislationUrl must be an unambiguous http(s) URL "
            "without credentials"
        ) from error
    return value


def _validate_string_set(
    value: Any,
    *,
    field: str,
    max_items: int,
    item_max_length: int,
) -> list[str]:
    if not isinstance(value, list):
        raise ValidationError(f"{field} must be an array")
    if len(value) > max_items:
        raise ValidationError(f"{field} exceeds {max_items} items")
    result: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        item = _required_trimmed_string(
            item,
            field=f"{field}[{index}]",
            max_length=item_max_length,
            identifier=True,
        )
        if item in seen:
            raise ValidationError(f"{field} contains a duplicate value")
        seen.add(item)
        result.append(item)
    result.sort()
    return result


def normalize_document(
    raw: Any,
    *,
    require_explicit_relations: bool,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValidationError("document must be an object")
    unknown = set(raw) - DOCUMENT_KEYS
    if unknown:
        raise ValidationError("document contains an unsupported field")

    document_id = validate_document_id(raw.get("id"))
    jurisdiction_raw = _required_trimmed_string(
        raw.get("jurisdiction"),
        field="document.jurisdiction",
        max_length=MAX_JURISDICTION_CHARS,
        identifier=True,
    )
    jurisdiction = jurisdiction_raw.upper()
    if not _JURISDICTION.fullmatch(jurisdiction):
        raise ValidationError("document.jurisdiction is invalid")

    document_type = _required_trimmed_string(
        raw.get("type"), field="document.type", max_length=32
    ).lower()
    if document_type not in DOCUMENT_TYPES:
        raise ValidationError("document.type is unsupported")

    title = _required_trimmed_string(
        raw.get("title"), field="document.title", max_length=MAX_TITLE_CHARS
    )
    short_title = _nullable_string(
        raw.get("shortTitle"),
        field="document.shortTitle",
        max_length=MAX_TITLE_CHARS,
    )

    year = raw.get("year")
    if year is not None:
        year = _normalized_integer(
            year,
            field="document.year",
            minimum=1,
            maximum=9_999,
        )

    sections_raw = raw.get("sections")
    if not isinstance(sections_raw, list) or not sections_raw:
        raise ValidationError("document.sections must be a non-empty array")
    if len(sections_raw) > MAX_SECTIONS:
        raise ValidationError(f"document.sections exceeds {MAX_SECTIONS} items")

    sections: list[dict[str, Any]] = []
    section_ids: set[str] = set()
    orders: set[int] = set()
    for index, section_raw in enumerate(sections_raw):
        if not isinstance(section_raw, dict):
            raise ValidationError(f"document.sections[{index}] must be an object")
        if set(section_raw) - SECTION_KEYS:
            raise ValidationError(f"document.sections[{index}] has an unsupported field")

        section_id = _required_trimmed_string(
            section_raw.get("sectionId"),
            field=f"document.sections[{index}].sectionId",
            max_length=MAX_SECTION_ID_CHARS,
            identifier=True,
        )
        if section_id in section_ids:
            raise ValidationError("document.sections contains a duplicate sectionId")
        section_ids.add(section_id)

        order = _normalized_integer(
            section_raw.get("order", index),
            field=f"document.sections[{index}].order",
            minimum=0,
            maximum=MAX_POSTGRES_INTEGER,
        )
        if order in orders:
            raise ValidationError("document.sections contains a duplicate order")
        orders.add(order)

        depth = _normalized_integer(
            section_raw.get("depth", 2),
            field=f"document.sections[{index}].depth",
            minimum=1,
            maximum=64,
        )

        status = section_raw.get("status", "in_force")
        status = _required_trimmed_string(
            status, field=f"document.sections[{index}].status", max_length=32
        ).lower()
        if status not in SECTION_STATUSES:
            raise ValidationError(f"document.sections[{index}].status is unsupported")

        cross_references = _validate_string_set(
            section_raw.get("crossReferences", []),
            field=f"document.sections[{index}].crossReferences",
            max_items=MAX_CROSS_REFERENCES,
            item_max_length=MAX_SECTION_ID_CHARS,
        )

        sections.append(
            {
                "sectionId": section_id,
                "title": _nullable_string(
                    section_raw.get("title"),
                    field=f"document.sections[{index}].title",
                    max_length=MAX_SECTION_TEXT_CHARS,
                ),
                "content": _section_content(
                    section_raw.get("content"), index=index
                ),
                "depth": depth,
                "parentSection": _nullable_string(
                    section_raw.get("parentSection"),
                    field=f"document.sections[{index}].parentSection",
                    max_length=MAX_SECTION_TEXT_CHARS,
                ),
                "order": order,
                "status": status,
                "amendedBy": _nullable_string(
                    section_raw.get("amendedBy"),
                    field=f"document.sections[{index}].amendedBy",
                    max_length=MAX_SECTION_TEXT_CHARS,
                ),
                "crossReferences": cross_references,
                "notes": _nullable_string(
                    section_raw.get("notes"),
                    field=f"document.sections[{index}].notes",
                    max_length=MAX_SECTION_NOTES_CHARS,
                ),
            }
        )
    sections.sort(key=lambda section: (section["order"], section["sectionId"]))

    if "relatedDocs" not in raw:
        if require_explicit_relations:
            raise ValidationError("document.relatedDocs must be an explicit array")
        related_docs: list[str] | None = None
    else:
        related_docs = _validate_string_set(
            raw["relatedDocs"],
            field="document.relatedDocs",
            max_items=MAX_RELATED_DOCUMENTS,
            item_max_length=MAX_DOCUMENT_ID_CHARS,
        )
        related_docs = [
            validate_document_id(item, field="document.relatedDocs item")
            for item in related_docs
        ]
        if document_id in related_docs:
            raise ValidationError("document.relatedDocs cannot contain the document itself")

    normalized: dict[str, Any] = {
        "id": document_id,
        "jurisdiction": jurisdiction,
        "type": document_type,
        "title": title,
        "shortTitle": short_title,
        "year": year,
        "number": _nullable_string(
            raw.get("number"),
            field="document.number",
            max_length=MAX_METADATA_CHARS,
        ),
        "inForceDate": validate_iso_date(
            raw.get("inForceDate"), field="document.inForceDate", nullable=True
        ),
        "lastAmendedDate": validate_iso_date(
            raw.get("lastAmendedDate"),
            field="document.lastAmendedDate",
            nullable=True,
        ),
        "repealedDate": validate_iso_date(
            raw.get("repealedDate"), field="document.repealedDate", nullable=True
        ),
        "administeredBy": _nullable_string(
            raw.get("administeredBy"),
            field="document.administeredBy",
            max_length=MAX_METADATA_CHARS,
        ),
        "legislationUrl": _validate_url(raw.get("legislationUrl")),
        "sections": sections,
    }
    if related_docs is not None:
        normalized["relatedDocs"] = related_docs
    return normalized


def document_payload_hash(document: Mapping[str, Any]) -> str:
    return hashlib.sha256(compact_json_bytes(dict(document))).hexdigest()


def validate_payload(
    raw: Any,
    *,
    require_explicit_relations: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(raw, dict) or set(raw) != {"documents"}:
        raise ValidationError("payload must contain only a documents array")
    documents = raw.get("documents")
    if not isinstance(documents, list) or len(documents) != 1:
        raise ValidationError("payload must contain exactly one document")
    document = normalize_document(
        documents[0], require_explicit_relations=require_explicit_relations
    )
    return {"documents": [document]}, document


def _parse_diagnostic_terms(value: Any) -> tuple[str, ...]:
    if not isinstance(value, str):
        raise ValidationError("diagnostic_terms_json must be a JSON string")
    terms_raw = parse_json_bytes(value.encode("utf-8"), label="diagnostic_terms_json")
    return validate_diagnostic_terms(terms_raw)


def validate_diagnostic_terms(value: Any) -> tuple[str, ...]:
    terms = _validate_string_set(
        value,
        field="diagnostic terms",
        max_items=MAX_DIAGNOSTIC_TERMS,
        item_max_length=200,
    )
    return tuple(terms)


def validate_workflow_inputs(inputs: Any) -> ReviewedIngest:
    if not isinstance(inputs, dict):
        raise ValidationError("workflow event inputs must be an object")
    if set(inputs) != WORKFLOW_INPUT_KEYS:
        raise ValidationError("workflow event inputs do not match the trusted contract")
    dispatch_size = serialized_inputs_size(inputs)

    builder_key = inputs.get("builder_key")
    if not isinstance(builder_key, str) or not _BUILDER_KEY.fullmatch(builder_key):
        raise ValidationError("builder_key is invalid")
    document_id = validate_document_id(inputs.get("document_id"))
    if inputs.get("document_id") != document_id:
        raise ValidationError("document_id must already be canonical")
    document_lock = inputs.get("document_lock")
    expected_lock = hashlib.sha256(document_id.encode("utf-8")).hexdigest()
    if document_lock != expected_lock:
        raise ValidationError("document_lock does not match document_id")
    expected_sections_raw = inputs.get("expected_sections")
    if not isinstance(expected_sections_raw, str) or not _EXPECTED_SECTIONS.fullmatch(
        expected_sections_raw
    ):
        raise ValidationError("expected_sections must be a positive decimal integer")
    expected_sections = int(expected_sections_raw)
    if expected_sections > MAX_SECTIONS:
        raise ValidationError(f"expected_sections exceeds {MAX_SECTIONS}")

    last_amended_date = validate_iso_date(
        inputs.get("last_amended_date"), field="last_amended_date"
    )
    assert last_amended_date is not None
    if inputs.get("last_amended_date") != last_amended_date:
        raise ValidationError("last_amended_date must already be canonical")
    dispatch_id = inputs.get("dispatch_id")
    if not isinstance(dispatch_id, str) or not _DISPATCH_ID.fullmatch(dispatch_id):
        raise ValidationError("dispatch_id must be 32 lowercase hexadecimal characters")
    diagnostic_terms = _parse_diagnostic_terms(inputs.get("diagnostic_terms_json"))

    payload_raw = decode_payload_gzip_b64(inputs.get("payload_gzip_b64"))
    parsed = parse_json_bytes(payload_raw, label="legislation payload")
    payload, document = validate_payload(parsed, require_explicit_relations=False)

    if document["id"] != document_id:
        raise ValidationError("payload document id does not match document_id")
    if len(document["sections"]) != expected_sections:
        raise ValidationError("payload section count does not match expected_sections")
    if document["lastAmendedDate"] != last_amended_date:
        raise ValidationError(
            "payload lastAmendedDate does not match last_amended_date"
        )

    payload_bytes = compact_json_bytes(payload)
    if len(payload_bytes) > MAX_DECOMPRESSED_BYTES:
        raise ValidationError(
            f"normalized payload exceeds {MAX_DECOMPRESSED_BYTES} bytes"
        )
    return ReviewedIngest(
        builder_key=builder_key,
        document_id=document_id,
        expected_sections=expected_sections,
        last_amended_date=last_amended_date,
        diagnostic_terms=diagnostic_terms,
        dispatch_id=dispatch_id,
        document=document,
        payload=payload,
        payload_bytes=payload_bytes,
        review_hash=hashlib.sha256(payload_bytes).hexdigest(),
        related_docs_explicit="relatedDocs" in document,
        dispatch_input_bytes=dispatch_size,
        decompressed_bytes=len(payload_raw),
    )


def authorize_reviewed_ingest(
    reviewed: ReviewedIngest,
    *,
    manifest_path: Path | None = None,
) -> None:
    """Bind workflow-controlled bytes to an exact entry in trusted main."""

    path = manifest_path or Path(__file__).with_name(
        "reviewed_legislation_builders.json"
    )
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_MANIFEST_BYTES + 1)
    except OSError as error:
        raise ValidationError("reviewed builder manifest could not be read") from error
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValidationError("reviewed builder manifest exceeds its byte limit")
    manifest = parse_json_bytes(raw, label="reviewed builder manifest")
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"version", "builders"}
        or manifest.get("version") != 1
        or not isinstance(manifest.get("builders"), dict)
    ):
        raise ValidationError("reviewed builder manifest shape is invalid")
    entry = manifest["builders"].get(reviewed.builder_key)
    if not isinstance(entry, dict):
        raise ValidationError("workflow builder is not allowlisted")
    try:
        manifest_terms = validate_diagnostic_terms(entry.get("diagnosticTerms"))
    except ValidationError as error:
        raise ValidationError("reviewed builder manifest values are invalid") from error
    expected_policy = "replace" if reviewed.related_docs_explicit else "preserve"
    if (
        entry.get("documentId") != reviewed.document_id
        or entry.get("expectedSections") != reviewed.expected_sections
        or entry.get("lastAmendedDate") != reviewed.last_amended_date
        or entry.get("relatedDocsPolicy") != expected_policy
        or manifest_terms != reviewed.diagnostic_terms
        or entry.get("normalizedPayloadSha256") != reviewed.review_hash
    ):
        raise ValidationError("workflow payload is not an exact reviewed manifest entry")


def load_workflow_event(path: Path) -> ReviewedIngest:
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_EVENT_BYTES + 1)
    except OSError as error:
        raise ValidationError("workflow event could not be read") from error
    if len(raw) > MAX_EVENT_BYTES:
        raise ValidationError(f"workflow event exceeds {MAX_EVENT_BYTES} bytes")
    event = parse_json_bytes(raw, label="workflow event")
    if not isinstance(event, dict):
        raise ValidationError("workflow event must be an object")
    return validate_workflow_inputs(event.get("inputs"))


def is_payload_hash(value: Any) -> bool:
    return isinstance(value, str) and _HASH.fullmatch(value) is not None
