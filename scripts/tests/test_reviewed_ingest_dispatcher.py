from __future__ import annotations

import hashlib
import json
import os
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import dispatch_reviewed_legislation_ingest as dispatcher
from dispatch_reviewed_legislation_ingest import DispatchError


def payload(content: str = "Reviewed content") -> dict:
    return {
        "documents": [
            {
                "id": "AU.Court/Act:Foo (2024)#1",
                "jurisdiction": "AU-QLD",
                "type": "local_law",
                "title": "Reviewed law",
                "lastAmendedDate": "2026-08-21",
                "sections": [
                    {
                        "sectionId": "s 1",
                        "content": content,
                    }
                ],
            }
        ]
    }


class BuilderFixture:
    def __init__(self, directory: Path, raw: bytes, *, script_body: str | None = None):
        self.directory = directory
        self.builder = directory / "build_reviewed_payload.py"
        body = script_body or f"import sys\nsys.stdout.buffer.write({raw!r})\n"
        self.builder.write_text(body, encoding="utf-8", newline="\n")
        self.raw = raw
        self.manifest = directory / "manifest.json"
        self.write_manifest()

    def write_manifest(self, **overrides) -> None:
        normalized, _ = dispatcher.validate_payload(
            json.loads(self.raw), require_explicit_relations=False
        )
        entry = {
            "relativePath": self.builder.name,
            "builderSha256": hashlib.sha256(self.builder.read_bytes()).hexdigest(),
            "rawPayloadSha256": hashlib.sha256(self.raw).hexdigest(),
            "rawPayloadBytes": len(self.raw),
            "normalizedPayloadSha256": hashlib.sha256(
                dispatcher.compact_json_bytes(normalized)
            ).hexdigest(),
            "requiredFiles": {},
            "documentId": "AU.Court/Act:Foo (2024)#1",
            "expectedSections": 1,
            "lastAmendedDate": "2026-08-21",
            "relatedDocsPolicy": "preserve",
            "diagnosticTerms": ["reviewed phrase"],
        }
        entry.update(overrides)
        self.manifest.write_text(
            json.dumps({"version": 1, "builders": {"reviewed": entry}}),
            encoding="utf-8",
            newline="\n",
        )

    def prepare(self):
        with mock.patch.object(dispatcher, "MANIFEST_PATH", self.manifest):
            return dispatcher.prepare_dispatch(self.directory, "reviewed")


class DispatcherTests(unittest.TestCase):
    def test_allowlisted_builder_runs_twice_and_preserves_relations_omission(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            fixture = BuilderFixture(Path(temporary), raw)
            prepared = fixture.prepare()
        self.assertEqual(prepared.builder.document_id, "AU.Court/Act:Foo (2024)#1")
        self.assertLessEqual(prepared.dispatch_input_bytes, 60_000)
        validated = dispatcher.validate_workflow_inputs(prepared.inputs)
        self.assertNotIn("relatedDocs", validated.document)
        self.assertFalse(validated.related_docs_explicit)
        self.assertEqual(validated.document["type"], "local_law")

    def test_unknown_builder_key_is_rejected(self) -> None:
        with self.assertRaisesRegex(DispatchError, "allowlisted"):
            dispatcher.load_reviewed_builder("not-reviewed")

    def test_manifest_path_escape_is_rejected(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            fixture = BuilderFixture(Path(temporary), raw)
            fixture.write_manifest(relativePath="../build_reviewed_payload.py")
            with mock.patch.object(dispatcher, "MANIFEST_PATH", fixture.manifest):
                with self.assertRaises(DispatchError):
                    dispatcher.load_reviewed_builder("reviewed")

    def test_builder_symlink_is_rejected(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = BuilderFixture(root, raw)
            target = root / "target.py"
            fixture.builder.replace(target)
            try:
                fixture.builder.symlink_to(target)
            except OSError:
                self.skipTest("symbolic links are unavailable")
            fixture.write_manifest(
                builderSha256=hashlib.sha256(target.read_bytes()).hexdigest()
            )
            with mock.patch.object(dispatcher, "MANIFEST_PATH", fixture.manifest):
                reviewed = dispatcher.load_reviewed_builder("reviewed")
                with self.assertRaisesRegex(DispatchError, "symbolic link"):
                    dispatcher.resolve_builder(root, reviewed)

    def test_builder_and_payload_hash_mismatches_fail(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            fixture = BuilderFixture(Path(temporary), raw)
            fixture.write_manifest(builderSha256="0" * 64)
            with self.assertRaisesRegex(DispatchError, "builder hash"):
                fixture.prepare()
            fixture.write_manifest(rawPayloadSha256="0" * 64)
            with self.assertRaisesRegex(DispatchError, "payload hash"):
                fixture.prepare()
            fixture.write_manifest(normalizedPayloadSha256="0" * 64)
            with self.assertRaisesRegex(DispatchError, "normalized payload hash"):
                fixture.prepare()

    def test_required_dependency_hash_is_enforced_before_execution(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = BuilderFixture(root, raw)
            dependency = root / "reviewed-data.json"
            dependency.write_text("reviewed", encoding="utf-8")
            expected = hashlib.sha256(dependency.read_bytes()).hexdigest()
            fixture.write_manifest(requiredFiles={dependency.name: expected})
            dependency.write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(DispatchError, "dependency hash"):
                fixture.prepare()

    def test_unpinned_sibling_module_is_not_available_to_builder(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "unreviewed_dependency.py").write_text(
                f"VALUE = {raw!r}\n", encoding="utf-8"
            )
            fixture = BuilderFixture(
                root,
                raw,
                script_body=(
                    "import sys\n"
                    "from unreviewed_dependency import VALUE\n"
                    "sys.stdout.buffer.write(VALUE)\n"
                ),
            )
            with self.assertRaisesRegex(DispatchError, "reviewed builder failed"):
                fixture.prepare()

    def test_relation_policy_must_match_builder_output(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            fixture = BuilderFixture(Path(temporary), raw)
            fixture.write_manifest(relatedDocsPolicy="replace")
            with self.assertRaisesRegex(DispatchError, "payload failed validation"):
                fixture.prepare()

    def test_nondeterministic_builder_fails_before_payload_validation(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        script = "import sys,time\nsys.stdout.write(str(time.time_ns()))\n"
        with tempfile.TemporaryDirectory() as temporary:
            fixture = BuilderFixture(Path(temporary), raw, script_body=script)
            with self.assertRaisesRegex(DispatchError, "byte-identical"):
                fixture.prepare()

    def test_builder_timeout_and_output_cap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(DispatchError, "timeout"):
                dispatcher.run_bounded(
                    [sys.executable, "-c", "import time; time.sleep(1)"],
                    cwd=root,
                    env=dispatcher._minimal_builder_env(),
                    timeout=0.05,
                    stdout_cap=1024,
                    stderr_cap=1024,
                )
            with self.assertRaisesRegex(DispatchError, "output limit"):
                dispatcher.run_bounded(
                    [sys.executable, "-c", "print('x' * 10000)"],
                    cwd=root,
                    env=dispatcher._minimal_builder_env(),
                    timeout=5,
                    stdout_cap=100,
                    stderr_cap=100,
                )

    def test_builder_environment_does_not_inherit_secrets(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                "SOURCE_INGEST_ADMIN_KEY": "must-not-pass",
                "UNRELATED_SECRET": "must-not-pass",
                "PATH": os.environ.get("PATH", ""),
            },
            clear=True,
        ):
            environment = dispatcher._minimal_builder_env()
        self.assertNotIn("SOURCE_INGEST_ADMIN_KEY", environment)
        self.assertNotIn("UNRELATED_SECRET", environment)
        self.assertEqual(environment["PYTHONHASHSEED"], "0")

    def test_full_dispatch_limit_rejects_incompressible_payload(self) -> None:
        generator = random.Random(5294)
        content = "".join(chr(generator.randrange(33, 127)) for _ in range(70_000))
        raw = json.dumps(payload(content), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            fixture = BuilderFixture(Path(temporary), raw)
            with self.assertRaisesRegex(DispatchError, "workflow inputs"):
                fixture.prepare()

    def test_dispatch_targets_fixed_workflow_and_main(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            prepared = BuilderFixture(Path(temporary), raw).prepare()
        calls: list[tuple[list[str], bytes | None]] = []

        def fake_gh(args, *, input_bytes=None):
            calls.append((list(args), input_bytes))
            if args[:2] == ["run", "list"]:
                return json.dumps(
                    [
                        {
                            "databaseId": 123,
                            "url": "https://github.com/TailorAU/tailor-app/actions/runs/123",
                            "displayTitle": f"Source ingest [{prepared.inputs['dispatch_id']}]",
                        }
                    ]
                ).encode("utf-8")
            return b""

        with mock.patch.object(dispatcher, "_run_gh", side_effect=fake_gh):
            run_id, _ = dispatcher.dispatch(prepared, watch=False)
        self.assertEqual(run_id, "123")
        dispatch_args, sent = calls[0]
        self.assertIn(dispatcher.WORKFLOW, dispatch_args)
        self.assertEqual(dispatch_args[dispatch_args.index("--ref") + 1], "main")
        self.assertEqual(json.loads(sent), prepared.inputs)
        self.assertNotIn("SOURCE_INGEST_ADMIN_KEY", sent.decode("utf-8"))
        self.assertNotIn(
            "relatedDocs",
            dispatcher.validate_workflow_inputs(json.loads(sent)).document,
        )

    def test_watch_uses_a_bounded_workflow_scale_timeout(self) -> None:
        raw = json.dumps(payload(), separators=(",", ":")).encode("utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            prepared = BuilderFixture(Path(temporary), raw).prepare()
        calls: list[tuple[list[str], float]] = []

        def fake_gh(
            args,
            *,
            input_bytes=None,
            timeout=dispatcher.GH_COMMAND_TIMEOUT_SECONDS,
        ):
            del input_bytes
            calls.append((list(args), timeout))
            if args[:2] == ["run", "list"]:
                return json.dumps(
                    [
                        {
                            "databaseId": 123,
                            "url": "https://github.com/TailorAU/tailor-app/actions/runs/123",
                            "displayTitle": (
                                f"Source ingest [{prepared.inputs['dispatch_id']}]"
                            ),
                        }
                    ]
                ).encode("utf-8")
            return b""

        with mock.patch.object(dispatcher, "_run_gh", side_effect=fake_gh):
            dispatcher.dispatch(prepared, watch=True)

        watch_call = next(call for call in calls if call[0][:2] == ["run", "watch"])
        self.assertEqual(dispatcher.GH_WATCH_TIMEOUT_SECONDS, 30 * 60.0)
        self.assertEqual(watch_call[1], dispatcher.GH_WATCH_TIMEOUT_SECONDS)
        self.assertTrue(
            all(
                timeout == dispatcher.GH_COMMAND_TIMEOUT_SECONDS
                for args, timeout in calls
                if args[:2] != ["run", "watch"]
            )
        )


if __name__ == "__main__":
    unittest.main()
