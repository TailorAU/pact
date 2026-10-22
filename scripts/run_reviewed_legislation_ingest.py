#!/usr/bin/env python3
"""Run one validated, reviewed legislation ingest against production.

Workflow values are read only from GITHUB_EVENT_PATH.  Payloads, diagnostic
terms, response bodies, and credentials are deliberately absent from output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from legislation_ingest_contract import (
    DIGEST_VERSION,
    ReviewedIngest,
    ValidationError,
    authorize_reviewed_ingest,
    compact_json_bytes,
    document_payload_hash,
    is_payload_hash,
    load_workflow_event,
    normalize_document,
    parse_json_bytes,
    validate_payload,
)


SOURCE_BASE_URL = "https://pact.tailor.au"
CANONICAL_PATH = "/api/axiom/legislation"
INGEST_PATH = "/api/axiom/legislation/ingest"
SEARCH_PATH = "/api/axiom/legislation/search"
MAX_CANONICAL_RESPONSE_BYTES = 20 * 1024 * 1024
MAX_POST_RESPONSE_BYTES = 1024 * 1024
MAX_SEARCH_RESPONSE_BYTES = 1024 * 1024
MAX_POST_ATTEMPTS = 3
INITIAL_READ_DELAYS = (0.0, 1.0, 2.0)
RECONCILE_DELAYS = (0.0, 2.0, 5.0, 10.0)
POST_RETRY_DELAYS = (2.0, 5.0)
_CORRELATION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SECRET_CONTROL = re.compile(r"[\x00-\x20\x7f]")


class RunnerError(RuntimeError):
    """An operational error whose message is safe for CI logs."""


class StateUnavailable(RunnerError):
    """The canonical endpoint did not provide authoritative state."""


class TransportFailure(RuntimeError):
    """A network failure. The original exception is never logged."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, url):
        return None


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class Transport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout: float,
        response_cap: int,
    ) -> HttpResponse: ...


def _read_bounded(stream: Any, cap: int) -> bytes:
    declared = stream.headers.get("Content-Length")
    if declared:
        try:
            if int(declared) > cap:
                raise TransportFailure("HTTP response exceeded its byte limit")
        except ValueError:
            pass
    body = stream.read(cap + 1)
    if len(body) > cap:
        raise TransportFailure("HTTP response exceeded its byte limit")
    return body


def _has_no_store(value: str) -> bool:
    return any(
        directive.split("=", 1)[0].strip().lower() == "no-store"
        for directive in value.split(",")
    )


class UrlLibTransport:
    def __init__(self) -> None:
        self._opener = build_opener(_NoRedirect)

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout: float,
        response_cap: int,
    ) -> HttpResponse:
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            with self._opener.open(request, timeout=timeout) as response:
                return HttpResponse(
                    status=response.status,
                    headers={key.lower(): value for key, value in response.headers.items()},
                    body=_read_bounded(response, response_cap),
                )
        except HTTPError as error:
            try:
                response_body = _read_bounded(error, response_cap)
            except TransportFailure:
                response_body = b""
            return HttpResponse(
                status=error.code,
                headers={key.lower(): value for key, value in error.headers.items()},
                body=response_body,
            )
        except (URLError, TimeoutError, socket.timeout, ConnectionError, OSError) as error:
            raise TransportFailure("HTTP transport failed") from error


@dataclass(frozen=True)
class CanonicalState:
    kind: str
    document: dict[str, Any] | None
    payload_hash: str | None
    expected_document: dict[str, Any]
    expected_hash: str


class ReviewedIngestRunner:
    def __init__(
        self,
        reviewed: ReviewedIngest,
        *,
        admin_key: str,
        correlation_id: str,
        transport: Transport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        base_url: str = SOURCE_BASE_URL,
        output: Callable[[str], None] = print,
    ) -> None:
        if (
            not admin_key
            or not 32 <= len(admin_key) <= 512
            or _SECRET_CONTROL.search(admin_key)
        ):
            raise RunnerError("SOURCE_INGEST_ADMIN_KEY is unavailable")
        if not _CORRELATION.fullmatch(correlation_id):
            raise RunnerError("workflow correlation id is invalid")
        self.reviewed = reviewed
        self.admin_key = admin_key
        self.correlation_id = correlation_id
        self.transport = transport or UrlLibTransport()
        self.sleep = sleep
        self.base_url = base_url.rstrip("/")
        self.output = output

    def _request(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
        timeout: float,
        response_cap: int,
    ) -> HttpResponse:
        safe_headers = {
            "Accept": "application/json",
            "Cache-Control": "no-cache, no-store, max-age=0",
            "Pragma": "no-cache",
            "User-Agent": "tailor-reviewed-legislation-ingest/1",
            "X-Request-ID": self.correlation_id,
        }
        if headers:
            safe_headers.update(headers)
        return self.transport.request(
            method,
            f"{self.base_url}{path}",
            headers=safe_headers,
            body=body,
            timeout=timeout,
            response_cap=response_cap,
        )

    def _canonical_state(self) -> CanonicalState:
        # This safe set is encodeURIComponent parity; in particular `/` and
        # spaces are encoded while case and punctuation bytes are preserved.
        encoded_id = quote(
            self.reviewed.document_id,
            safe="-_.!~*'()",
            encoding="utf-8",
            errors="strict",
        )
        try:
            response = self._request(
                "GET",
                f"{CANONICAL_PATH}?id={encoded_id}&format=canonical",
                timeout=20.0,
                response_cap=MAX_CANONICAL_RESPONSE_BYTES,
            )
        except TransportFailure as error:
            raise StateUnavailable("canonical read transport failed") from error

        cache_control = response.headers.get("cache-control", "")
        if response.status in {200, 404} and not _has_no_store(cache_control):
            raise StateUnavailable("canonical response omitted no-store")

        if response.status == 404:
            try:
                body = parse_json_bytes(response.body, label="canonical 404 response")
            except ValidationError as error:
                raise StateUnavailable("canonical 404 response was malformed") from error
            if body != {
                "error": "legislation_not_found",
                "id": self.reviewed.document_id,
            }:
                raise StateUnavailable("canonical 404 response did not match its contract")
            expected = self._expected_complete_document(None)
            return CanonicalState(
                "absent",
                None,
                None,
                expected,
                document_payload_hash(expected),
            )

        if response.status != 200:
            raise StateUnavailable(
                f"canonical read returned HTTP {response.status}"
            )
        try:
            body = parse_json_bytes(response.body, label="canonical response")
            if not isinstance(body, dict) or set(body) != {
                "document",
                "sectionCount",
                "digestVersion",
                "payloadHash",
            }:
                raise ValidationError("canonical response shape is invalid")
            if body["digestVersion"] != DIGEST_VERSION:
                raise ValidationError("canonical digest version is unsupported")
            if not is_payload_hash(body["payloadHash"]):
                raise ValidationError("canonical payload hash is invalid")
            document = normalize_document(
                body["document"], require_explicit_relations=True
            )
            if body["document"] != document:
                raise ValidationError("canonical document is not normalized")
            if document["id"] != self.reviewed.document_id:
                raise ValidationError("canonical document id does not match the exact query")
            section_count = body["sectionCount"]
            if (
                isinstance(section_count, bool)
                or not isinstance(section_count, int)
                or section_count != len(document["sections"])
            ):
                raise ValidationError("canonical section count is invalid")
            computed_hash = document_payload_hash(document)
            if body["payloadHash"] != computed_hash:
                raise ValidationError("canonical payload hash does not verify")
        except (KeyError, ValidationError) as error:
            raise StateUnavailable("canonical response failed contract validation") from error

        stored_date = document["lastAmendedDate"]
        if stored_date is not None and stored_date > self.reviewed.last_amended_date:
            raise RunnerError("stored document is newer than the reviewed payload")
        expected = self._expected_complete_document(document)
        expected_hash = document_payload_hash(expected)
        if computed_hash == expected_hash and document == expected:
            return CanonicalState(
                "exact", document, computed_hash, expected, expected_hash
            )
        return CanonicalState(
            "mismatch", document, computed_hash, expected, expected_hash
        )

    def _expected_complete_document(
        self, stored_document: Mapping[str, Any] | None
    ) -> dict[str, Any]:
        expected = dict(self.reviewed.document)
        if not self.reviewed.related_docs_explicit:
            expected["relatedDocs"] = (
                []
                if stored_document is None
                else list(stored_document["relatedDocs"])
            )
        return expected

    def _poll_state(
        self,
        delays: tuple[float, ...],
        *,
        require_final_observation: bool,
    ) -> CanonicalState:
        last_error: StateUnavailable | None = None
        for index, delay in enumerate(delays):
            if delay:
                self.sleep(delay)
            try:
                state = self._canonical_state()
            except StateUnavailable as error:
                last_error = error
                continue
            if state.kind == "exact":
                return state
            if not require_final_observation or index == len(delays) - 1:
                return state
        raise StateUnavailable("canonical state could not be established") from last_error

    def _guard_payload_before_post(self) -> None:
        payload, document = validate_payload(
            self.reviewed.payload, require_explicit_relations=False
        )
        if (
            document != self.reviewed.document
            or compact_json_bytes(payload) != self.reviewed.payload_bytes
            or hashlib.sha256(compact_json_bytes(payload)).hexdigest()
            != self.reviewed.review_hash
            or ("relatedDocs" in document) != self.reviewed.related_docs_explicit
            or document["id"] != self.reviewed.document_id
            or len(document["sections"]) != self.reviewed.expected_sections
            or document["lastAmendedDate"] != self.reviewed.last_amended_date
        ):
            raise RunnerError("reviewed payload changed after validation")

    def _report_exact_hashes(self, state: CanonicalState, *, phase: str) -> None:
        if state.kind != "exact" or state.payload_hash is None:
            raise RunnerError("exact canonical hash evidence is unavailable")
        self.output(
            f"{phase} stored_canonical_hash={state.payload_hash} "
            f"expected_canonical_hash={state.expected_hash}"
        )

    def _validate_post_success(self, response: HttpResponse) -> None:
        try:
            body = parse_json_bytes(response.body, label="ingest response")
            if not isinstance(body, dict) or set(body) != {
                "ingested",
                "documents",
                "message",
            }:
                raise ValidationError("ingest response shape is invalid")
            documents = body["documents"]
            if (
                isinstance(body["ingested"], bool)
                or not isinstance(body["ingested"], int)
                or body["ingested"] != 1
                or not isinstance(documents, list)
                or len(documents) != 1
                or not isinstance(documents[0], dict)
                or set(documents[0]) != {"id", "title", "sectionsInserted"}
                or documents[0].get("id") != self.reviewed.document_id
                or documents[0].get("title") != self.reviewed.document["title"]
                or isinstance(documents[0].get("sectionsInserted"), bool)
                or not isinstance(documents[0].get("sectionsInserted"), int)
                or documents[0].get("sectionsInserted")
                != self.reviewed.expected_sections
                or not isinstance(body["message"], str)
            ):
                raise ValidationError("ingest response values are invalid")
        except (KeyError, ValidationError) as error:
            raise RunnerError("successful ingest response failed contract validation") from error

    def _post_once(self) -> HttpResponse:
        return self._request(
            "POST",
            INGEST_PATH,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Admin-Key": self.admin_key,
                # tailor-group#35: only this assertion makes Source stamp
                # legislation_docs.reviewed_at / review_hash. Every other
                # admin POST (deploy seeds) is guarded like a scheduled sync.
                "X-Ingest-Source": "reviewed",
            },
            body=self.reviewed.payload_bytes,
            timeout=45.0,
            response_cap=MAX_POST_RESPONSE_BYTES,
        )

    def _search_diagnostics(self) -> None:
        for index, term in enumerate(self.reviewed.diagnostic_terms, start=1):
            query = urlencode({"q": term, "limit": "200"})
            try:
                response = self._request(
                    "GET",
                    f"{SEARCH_PATH}?{query}",
                    timeout=20.0,
                    response_cap=MAX_SEARCH_RESPONSE_BYTES,
                )
                if response.status != 200:
                    raise RunnerError("diagnostic search returned a non-success status")
                body = parse_json_bytes(response.body, label="diagnostic search response")
                if not isinstance(body, dict) or not isinstance(body.get("results"), list):
                    raise ValidationError("diagnostic search response shape is invalid")
                hits = sum(
                    1
                    for result in body["results"]
                    if isinstance(result, dict)
                    and result.get("docId") == self.reviewed.document_id
                )
                if hits:
                    self.output(f"diagnostic term {index}: document hits={hits}")
                else:
                    self.output(
                        f"::warning::diagnostic term {index}: reviewed document was not returned"
                    )
            except (RunnerError, TransportFailure, ValidationError):
                self.output(f"::warning::diagnostic term {index}: search unavailable")

    def run(self) -> str:
        self.output(
            "validated reviewed ingest "
            f"document={self.reviewed.document_id} "
            f"sections={self.reviewed.expected_sections} "
            f"review_hash={self.reviewed.review_hash} "
            f"dispatch={self.reviewed.dispatch_id} "
            f"correlation={self.correlation_id}"
        )
        state = self._poll_state(
            INITIAL_READ_DELAYS, require_final_observation=False
        )
        relation_policy = (
            "replace" if self.reviewed.related_docs_explicit else "preserve"
        )
        self.output(
            f"expected canonical hash={state.expected_hash} "
            f"related_docs_policy={relation_policy}"
        )
        if state.kind == "exact":
            self._report_exact_hashes(state, phase="exact-skip")
            self.output("canonical state is already exact; POST skipped")
            self._search_diagnostics()
            return "skipped"

        for attempt in range(1, MAX_POST_ATTEMPTS + 1):
            state = self._poll_state(
                INITIAL_READ_DELAYS, require_final_observation=False
            )
            if state.kind == "exact":
                self._report_exact_hashes(state, phase="pre-post-reconciled")
                self.output("canonical state converged before POST; POST skipped")
                self._search_diagnostics()
                return "reconciled"

            self._guard_payload_before_post()
            self.output(f"pre-POST expected canonical hash={state.expected_hash}")
            self.output(f"POST attempt={attempt} of {MAX_POST_ATTEMPTS}")
            try:
                response = self._post_once()
            except TransportFailure:
                response = None

            if response is not None and 200 <= response.status < 300:
                self._validate_post_success(response)
                state = self._poll_state(
                    RECONCILE_DELAYS, require_final_observation=True
                )
                if state.kind != "exact":
                    raise RunnerError(
                        "successful ingest did not converge to expected canonical state"
                    )
                self._report_exact_hashes(state, phase="post-verified")
                self.output("canonical post-verification succeeded")
                self._search_diagnostics()
                return "ingested"

            ambiguous = response is None or response.status in {408, 429} or (
                response.status >= 500
            )
            if not ambiguous:
                assert response is not None
                raise RunnerError(
                    f"ingest POST returned non-retryable HTTP {response.status}"
                )

            self.output("ambiguous POST outcome; reconciling exact canonical state")
            state = self._poll_state(
                RECONCILE_DELAYS, require_final_observation=True
            )
            if state.kind == "exact":
                self._report_exact_hashes(state, phase="ambiguous-post-reconciled")
                self.output("ambiguous POST was stored; no retry required")
                self._search_diagnostics()
                return "reconciled"
            if attempt == MAX_POST_ATTEMPTS:
                raise RunnerError("ingest POST retry cap reached after reconciliation")
            self.output("reconciliation proved non-exact state; retry permitted")
            self.sleep(POST_RETRY_DELAYS[attempt - 1])

        raise RunnerError("ingest ended without a verified canonical state")


def _event_path(argument: str | None) -> Path:
    raw = argument or os.environ.get("GITHUB_EVENT_PATH")
    if not raw:
        raise RunnerError("GITHUB_EVENT_PATH is unavailable")
    return Path(raw)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-path")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    try:
        reviewed = load_workflow_event(_event_path(args.event_path))
        authorize_reviewed_ingest(reviewed)
        print(
            "validation succeeded "
            f"builder={reviewed.builder_key} "
            f"document={reviewed.document_id} "
            f"sections={reviewed.expected_sections} "
            f"review_hash={reviewed.review_hash} "
            f"input_bytes={reviewed.dispatch_input_bytes} "
            f"payload_bytes={reviewed.decompressed_bytes}"
        )
        if args.validate_only:
            return 0
        runner = ReviewedIngestRunner(
            reviewed,
            admin_key=os.environ.get("SOURCE_INGEST_ADMIN_KEY", ""),
            correlation_id=os.environ.get("SOURCE_INGEST_CORRELATION_ID", ""),
        )
        runner.run()
        return 0
    except (RunnerError, StateUnavailable, ValidationError) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
