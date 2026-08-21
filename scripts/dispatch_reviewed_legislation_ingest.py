#!/usr/bin/env python3
"""Build and dispatch one repository-allowlisted legislation payload.

The dispatcher never reads the Source admin key. External builders run with a
minimal environment, bounded pipes, a fixed cwd, and a hard timeout.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from legislation_ingest_contract import (
    MAX_DECOMPRESSED_BYTES,
    MAX_SECTIONS,
    ValidationError,
    compact_json_bytes,
    parse_json_bytes,
    serialized_inputs_size,
    validate_diagnostic_terms,
    validate_document_id,
    validate_iso_date,
    validate_payload,
    validate_workflow_inputs,
)


REPOSITORY = "TailorAU/tailor-app"
WORKFLOW = "source-legislation-ingest.yml"
BRANCH = "main"
MANIFEST_PATH = Path(__file__).with_name("reviewed_legislation_builders.json")
BUILDER_TIMEOUT_SECONDS = 300.0
BUILDER_STDERR_CAP = 64 * 1024
COMMAND_OUTPUT_CAP = 64 * 1024
BUILDER_FILE_CAP = 1024 * 1024
GH_COMMAND_TIMEOUT_SECONDS = 60.0
GH_WATCH_TIMEOUT_SECONDS = 30 * 60.0
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_BUILDER_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_BUILDER_FILE = re.compile(r"^build_[a-z0-9_]+_payload\.py$")
_REQUIRED_FILE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}\.(?:json|py)$")
_RUN_URL = re.compile(
    r"^https://github\.com/TailorAU/tailor-app/actions/runs/(?P<run_id>[1-9][0-9]*)$"
)


class DispatchError(RuntimeError):
    """A safe dispatcher error that never contains external process output."""


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: bytes
    stderr: bytes


@dataclass(frozen=True)
class ReviewedBuilder:
    key: str
    relative_path: str
    builder_sha256: str
    raw_payload_sha256: str
    raw_payload_bytes: int
    normalized_payload_sha256: str
    required_files: tuple[tuple[str, str], ...]
    document_id: str
    expected_sections: int
    last_amended_date: str
    related_docs_policy: str
    diagnostic_terms: tuple[str, ...]


@dataclass(frozen=True)
class PreparedDispatch:
    builder: ReviewedBuilder
    inputs: dict[str, str]
    review_hash: str
    normalized_payload_bytes: int
    dispatch_input_bytes: int


def _capture_pipe(
    pipe: Any,
    *,
    cap: int,
    buffer: bytearray,
    exceeded: threading.Event,
) -> None:
    try:
        while True:
            chunk = pipe.read(64 * 1024)
            if not chunk:
                break
            remaining = cap + 1 - len(buffer)
            if remaining > 0:
                buffer.extend(chunk[:remaining])
            if len(buffer) > cap or len(chunk) > remaining:
                exceeded.set()
                break
    finally:
        pipe.close()


def _write_stdin(pipe: Any, value: bytes) -> None:
    try:
        pipe.write(value)
        pipe.flush()
    except (BrokenPipeError, OSError):
        pass
    finally:
        pipe.close()


def run_bounded(
    command: Sequence[str],
    *,
    cwd: Path,
    env: Mapping[str, str],
    timeout: float,
    stdout_cap: int,
    stderr_cap: int,
    input_bytes: bytes | None = None,
) -> ProcessResult:
    try:
        process = subprocess.Popen(
            list(command),
            cwd=str(cwd),
            env=dict(env),
            stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            close_fds=True,
        )
    except OSError as error:
        raise DispatchError("external process could not be started") from error
    assert process.stdout is not None and process.stderr is not None

    stdout = bytearray()
    stderr = bytearray()
    exceeded = threading.Event()
    readers = [
        threading.Thread(
            target=_capture_pipe,
            kwargs={
                "pipe": process.stdout,
                "cap": stdout_cap,
                "buffer": stdout,
                "exceeded": exceeded,
            },
            daemon=True,
        ),
        threading.Thread(
            target=_capture_pipe,
            kwargs={
                "pipe": process.stderr,
                "cap": stderr_cap,
                "buffer": stderr,
                "exceeded": exceeded,
            },
            daemon=True,
        ),
    ]
    for reader in readers:
        reader.start()

    writer: threading.Thread | None = None
    if input_bytes is not None:
        assert process.stdin is not None
        writer = threading.Thread(
            target=_write_stdin,
            args=(process.stdin, input_bytes),
            daemon=True,
        )
        writer.start()

    deadline = time.monotonic() + timeout
    timed_out = False
    while process.poll() is None:
        if exceeded.is_set():
            process.kill()
            break
        if time.monotonic() >= deadline:
            timed_out = True
            process.kill()
            break
        time.sleep(0.02)
    process.wait()
    for reader in readers:
        reader.join(timeout=5.0)
    if writer is not None:
        writer.join(timeout=5.0)

    if timed_out:
        raise DispatchError("external process exceeded its timeout")
    if exceeded.is_set() or len(stdout) > stdout_cap or len(stderr) > stderr_cap:
        raise DispatchError("external process exceeded its output limit")
    return ProcessResult(process.returncode, bytes(stdout), bytes(stderr))


def _minimal_builder_env() -> dict[str, str]:
    allowed = {
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "WINDIR",
    }
    environment = {
        key: value for key, value in os.environ.items() if key in allowed and value
    }
    environment.update(
        {
            "PYTHONHASHSEED": "0",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
        }
    )
    return environment


def _minimal_gh_env() -> dict[str, str]:
    allowed = {
        "APPDATA",
        "COMSPEC",
        "GH_CONFIG_DIR",
        "GH_HOST",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "HOME",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "LOCALAPPDATA",
        "NO_PROXY",
        "PATH",
        "PATHEXT",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
    }
    return {key: value for key, value in os.environ.items() if key in allowed and value}


def _safe_sha256(path: Path) -> str:
    try:
        if path.stat().st_size > BUILDER_FILE_CAP:
            raise DispatchError("reviewed builder exceeds its file size limit")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(64 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError as error:
        raise DispatchError("reviewed builder could not be read") from error


def load_reviewed_builder(key: str) -> ReviewedBuilder:
    if not _BUILDER_NAME.fullmatch(key):
        raise DispatchError("builder key is invalid")
    try:
        raw = MANIFEST_PATH.read_bytes()
    except OSError as error:
        raise DispatchError("reviewed builder manifest could not be read") from error
    try:
        manifest = parse_json_bytes(raw, label="reviewed builder manifest")
    except ValidationError as error:
        raise DispatchError("reviewed builder manifest is invalid") from error
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"version", "builders"}
        or manifest["version"] != 1
        or not isinstance(manifest["builders"], dict)
    ):
        raise DispatchError("reviewed builder manifest shape is invalid")
    entry = manifest["builders"].get(key)
    expected_keys = {
        "relativePath",
        "builderSha256",
        "rawPayloadSha256",
        "rawPayloadBytes",
        "normalizedPayloadSha256",
        "requiredFiles",
        "documentId",
        "expectedSections",
        "lastAmendedDate",
        "relatedDocsPolicy",
        "diagnosticTerms",
    }
    if not isinstance(entry, dict) or set(entry) != expected_keys:
        raise DispatchError("builder is not allowlisted by the reviewed manifest")
    if (
        not isinstance(entry["relativePath"], str)
        or not _BUILDER_FILE.fullmatch(entry["relativePath"])
        or not isinstance(entry["builderSha256"], str)
        or not _SHA256.fullmatch(entry["builderSha256"])
        or not isinstance(entry["rawPayloadSha256"], str)
        or not _SHA256.fullmatch(entry["rawPayloadSha256"])
        or not isinstance(entry["normalizedPayloadSha256"], str)
        or not _SHA256.fullmatch(entry["normalizedPayloadSha256"])
        or isinstance(entry["rawPayloadBytes"], bool)
        or not isinstance(entry["rawPayloadBytes"], int)
        or not 1 <= entry["rawPayloadBytes"] <= MAX_DECOMPRESSED_BYTES
        or not isinstance(entry["requiredFiles"], dict)
        or len(entry["requiredFiles"]) > 32
        or isinstance(entry["expectedSections"], bool)
        or not isinstance(entry["expectedSections"], int)
        or not 1 <= entry["expectedSections"] <= MAX_SECTIONS
        or not isinstance(entry["relatedDocsPolicy"], str)
        or entry["relatedDocsPolicy"] not in {"preserve", "replace"}
        or not isinstance(entry["diagnosticTerms"], list)
        or not all(isinstance(term, str) for term in entry["diagnosticTerms"])
    ):
        raise DispatchError("reviewed builder manifest values are invalid")
    required_files: list[tuple[str, str]] = []
    for required_name, required_hash in entry["requiredFiles"].items():
        if (
            not isinstance(required_name, str)
            or not _REQUIRED_FILE.fullmatch(required_name)
            or required_name == entry["relativePath"]
            or not isinstance(required_hash, str)
            or not _SHA256.fullmatch(required_hash)
        ):
            raise DispatchError("reviewed builder required-file manifest is invalid")
        required_files.append((required_name, required_hash))
    try:
        document_id = validate_document_id(entry["documentId"])
        last_amended_date = validate_iso_date(
            entry["lastAmendedDate"], field="manifest lastAmendedDate"
        )
        diagnostic_terms = validate_diagnostic_terms(entry["diagnosticTerms"])
    except ValidationError as error:
        raise DispatchError("reviewed builder manifest values are invalid") from error
    assert last_amended_date is not None
    return ReviewedBuilder(
        key=key,
        relative_path=entry["relativePath"],
        builder_sha256=entry["builderSha256"],
        raw_payload_sha256=entry["rawPayloadSha256"],
        raw_payload_bytes=entry["rawPayloadBytes"],
        normalized_payload_sha256=entry["normalizedPayloadSha256"],
        required_files=tuple(sorted(required_files)),
        document_id=document_id,
        expected_sections=entry["expectedSections"],
        last_amended_date=last_amended_date,
        related_docs_policy=entry["relatedDocsPolicy"],
        diagnostic_terms=diagnostic_terms,
    )


def _resolve_direct_file(root: Path, name: str, *, label: str) -> Path:
    relative = Path(name)
    if relative.is_absolute() or relative.parent != Path("."):
        raise DispatchError(f"{label} path is not a direct child")
    candidate = root / relative
    if candidate.is_symlink():
        raise DispatchError(f"{label} cannot be a symbolic link")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as error:
        raise DispatchError(f"{label} escapes its approved root") from error
    if not resolved.is_file():
        raise DispatchError(f"{label} is not a regular file")
    return resolved


def resolve_builder(
    builder_root: Path, reviewed: ReviewedBuilder
) -> tuple[Path, Path, tuple[tuple[Path, str], ...]]:
    if builder_root.is_symlink():
        raise DispatchError("builder root cannot be a symbolic link")
    try:
        root = builder_root.resolve(strict=True)
    except OSError as error:
        raise DispatchError("builder root does not exist") from error
    if not root.is_dir():
        raise DispatchError("builder root is not a directory")
    builder = _resolve_direct_file(root, reviewed.relative_path, label="reviewed builder")
    if _safe_sha256(builder) != reviewed.builder_sha256:
        raise DispatchError("reviewed builder hash does not match the manifest")
    required: list[tuple[Path, str]] = []
    for name, expected_hash in reviewed.required_files:
        required_file = _resolve_direct_file(root, name, label="reviewed dependency")
        if _safe_sha256(required_file) != expected_hash:
            raise DispatchError("reviewed dependency hash does not match the manifest")
        required.append((required_file, expected_hash))
    return root, builder, tuple(required)


def _verify_reviewed_files(
    builder: Path,
    builder_hash: str,
    required_files: tuple[tuple[Path, str], ...],
) -> None:
    if _safe_sha256(builder) != builder_hash:
        raise DispatchError("reviewed builder changed during execution")
    for required_file, expected_hash in required_files:
        if required_file.is_symlink() or _safe_sha256(required_file) != expected_hash:
            raise DispatchError("reviewed dependency changed during execution")


def _run_builder(root: Path, builder: Path) -> bytes:
    bootstrap = (
        "import runpy,sys;"
        "sys.path.insert(0,sys.argv[1]);"
        "runpy.run_path(sys.argv[2],run_name='__main__')"
    )
    with tempfile.TemporaryDirectory(
        prefix="tailor-reviewed-builder-pycache-"
    ) as pycache:
        result = run_bounded(
            [
                sys.executable,
                "-X",
                "utf8",
                "-X",
                f"pycache_prefix={pycache}",
                "-I",
                "-c",
                bootstrap,
                str(root),
                str(builder),
            ],
            cwd=root,
            env=_minimal_builder_env(),
            timeout=BUILDER_TIMEOUT_SECONDS,
            stdout_cap=MAX_DECOMPRESSED_BYTES,
            stderr_cap=BUILDER_STDERR_CAP,
        )
    if result.returncode != 0:
        raise DispatchError("reviewed builder failed")
    if result.stderr:
        raise DispatchError("reviewed builder emitted unexpected stderr")
    if not result.stdout:
        raise DispatchError("reviewed builder emitted an empty payload")
    return result.stdout


def _run_builder_snapshot(
    builder: Path,
    builder_hash: str,
    required_files: tuple[tuple[Path, str], ...],
) -> bytes:
    """Execute only a fresh copy of the manifest-pinned dependency closure."""

    with tempfile.TemporaryDirectory(
        prefix="tailor-reviewed-builder-snapshot-"
    ) as temporary:
        root = Path(temporary)
        approved = ((builder, builder_hash), *required_files)
        for source, expected_hash in approved:
            destination = root / source.name
            try:
                shutil.copyfile(source, destination)
            except OSError as error:
                raise DispatchError("reviewed file snapshot failed") from error
            if _safe_sha256(destination) != expected_hash:
                raise DispatchError("reviewed file snapshot hash did not verify")
        return _run_builder(root, root / builder.name)


def _deterministic_gzip(raw: bytes) -> bytes:
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as stream:
        stream.write(raw)
    return output.getvalue()


def prepare_dispatch(builder_root: Path, key: str) -> PreparedDispatch:
    reviewed = load_reviewed_builder(key)
    _root, builder, required_files = resolve_builder(builder_root, reviewed)
    first = _run_builder_snapshot(
        builder, reviewed.builder_sha256, required_files
    )
    _verify_reviewed_files(builder, reviewed.builder_sha256, required_files)
    second = _run_builder_snapshot(
        builder, reviewed.builder_sha256, required_files
    )
    _verify_reviewed_files(builder, reviewed.builder_sha256, required_files)
    if first != second:
        raise DispatchError("reviewed builder output is not byte-identical")
    if len(first) != reviewed.raw_payload_bytes:
        raise DispatchError("builder payload size does not match the manifest")
    if hashlib.sha256(first).hexdigest() != reviewed.raw_payload_sha256:
        raise DispatchError("builder payload hash does not match the manifest")

    try:
        raw_payload = parse_json_bytes(first, label="reviewed builder payload")
        documents = raw_payload.get("documents") if isinstance(raw_payload, dict) else None
        raw_document = (
            documents[0]
            if isinstance(documents, list)
            and len(documents) == 1
            and isinstance(documents[0], dict)
            else None
        )
        relations_are_explicit = (
            isinstance(raw_document, dict) and "relatedDocs" in raw_document
        )
        if reviewed.related_docs_policy == "preserve" and relations_are_explicit:
            raise ValidationError("preserve policy requires relatedDocs omission")
        if reviewed.related_docs_policy == "replace" and not relations_are_explicit:
            raise ValidationError("replace policy requires explicit relatedDocs")
        payload, document = validate_payload(
            raw_payload, require_explicit_relations=False
        )
    except ValidationError as error:
        raise DispatchError("reviewed builder payload failed validation") from error
    if (
        document["id"] != reviewed.document_id
        or len(document["sections"]) != reviewed.expected_sections
        or document["lastAmendedDate"] != reviewed.last_amended_date
    ):
        raise DispatchError("builder payload does not match reviewed manifest metadata")

    normalized = compact_json_bytes(payload)
    if hashlib.sha256(normalized).hexdigest() != reviewed.normalized_payload_sha256:
        raise DispatchError("normalized payload hash does not match the manifest")
    encoded = base64.b64encode(_deterministic_gzip(normalized)).decode("ascii")
    inputs = {
        "builder_key": reviewed.key,
        "diagnostic_terms_json": json.dumps(
            list(reviewed.diagnostic_terms), ensure_ascii=False, separators=(",", ":")
        ),
        "dispatch_id": uuid.uuid4().hex,
        "document_id": reviewed.document_id,
        "document_lock": hashlib.sha256(
            reviewed.document_id.encode("utf-8")
        ).hexdigest(),
        "expected_sections": str(reviewed.expected_sections),
        "last_amended_date": reviewed.last_amended_date,
        "payload_gzip_b64": encoded,
    }
    try:
        input_size = serialized_inputs_size(inputs)
        validated = validate_workflow_inputs(inputs)
    except ValidationError as error:
        raise DispatchError("prepared workflow inputs failed validation") from error
    return PreparedDispatch(
        builder=reviewed,
        inputs=inputs,
        review_hash=validated.review_hash,
        normalized_payload_bytes=len(normalized),
        dispatch_input_bytes=input_size,
    )


def _run_gh(
    args: Sequence[str],
    *,
    input_bytes: bytes | None = None,
    timeout: float = GH_COMMAND_TIMEOUT_SECONDS,
) -> bytes:
    result = run_bounded(
        ["gh", *args],
        cwd=Path.cwd(),
        env=_minimal_gh_env(),
        timeout=timeout,
        stdout_cap=COMMAND_OUTPUT_CAP,
        stderr_cap=COMMAND_OUTPUT_CAP,
        input_bytes=input_bytes,
    )
    if result.returncode != 0:
        raise DispatchError("GitHub CLI command failed")
    return result.stdout


def dispatch(prepared: PreparedDispatch, *, watch: bool) -> tuple[str, str]:
    input_bytes = compact_json_bytes(prepared.inputs)
    _run_gh(
        [
            "workflow",
            "run",
            WORKFLOW,
            "--repo",
            REPOSITORY,
            "--ref",
            BRANCH,
            "--json",
        ],
        input_bytes=input_bytes,
    )
    dispatch_id = prepared.inputs["dispatch_id"]
    run_id: str | None = None
    run_url: str | None = None
    for _ in range(13):
        listed = _run_gh(
            [
                "run",
                "list",
                "--repo",
                REPOSITORY,
                "--workflow",
                WORKFLOW,
                "--branch",
                BRANCH,
                "--event",
                "workflow_dispatch",
                "--limit",
                "30",
                "--json",
                "databaseId,url,displayTitle",
            ]
        )
        try:
            runs = parse_json_bytes(listed, label="GitHub run list")
        except ValidationError as error:
            raise DispatchError("GitHub run list response was invalid") from error
        if isinstance(runs, list):
            for candidate in runs:
                if (
                    isinstance(candidate, dict)
                    and candidate.get("displayTitle")
                    == f"Source ingest [{dispatch_id}]"
                    and isinstance(candidate.get("databaseId"), int)
                    and isinstance(candidate.get("url"), str)
                ):
                    candidate_id = str(candidate["databaseId"])
                    url_match = _RUN_URL.fullmatch(candidate["url"])
                    if url_match and url_match.group("run_id") == candidate_id:
                        run_id = candidate_id
                        run_url = candidate["url"]
                        break
        if run_id is not None:
            break
        time.sleep(5.0)
    if run_id is None or run_url is None:
        raise DispatchError("workflow dispatched but its run id was not observed")
    if watch:
        _run_gh(
            [
                "run",
                "watch",
                run_id,
                "--repo",
                REPOSITORY,
                "--interval",
                "10",
                "--compact",
                "--exit-status",
            ],
            timeout=GH_WATCH_TIMEOUT_SECONDS,
        )
    return run_id, run_url


def _safe_summary(prepared: PreparedDispatch, *, phase: str) -> dict[str, Any]:
    return {
        "phase": phase,
        "builderKey": prepared.builder.key,
        "documentId": prepared.builder.document_id,
        "sections": prepared.builder.expected_sections,
        "lastAmendedDate": prepared.builder.last_amended_date,
        "reviewHash": prepared.review_hash,
        "relatedDocsPolicy": prepared.builder.related_docs_policy,
        "normalizedPayloadBytes": prepared.normalized_payload_bytes,
        "dispatchInputBytes": prepared.dispatch_input_bytes,
        "dispatchId": prepared.inputs["dispatch_id"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--builder-key", required=True)
    parser.add_argument("--builder-root", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args(argv)
    try:
        prepared = prepare_dispatch(args.builder_root, args.builder_key)
        if args.dry_run:
            print(
                json.dumps(
                    _safe_summary(prepared, phase="dry_run"),
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            return 0
        run_id, run_url = dispatch(prepared, watch=args.watch)
        summary = _safe_summary(prepared, phase="dispatched")
        summary.update({"runId": run_id, "runUrl": run_url})
        print(
            json.dumps(
                summary,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
        )
        return 0
    except DispatchError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
