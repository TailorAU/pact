from __future__ import annotations

import base64
import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from helpers import raw_document, reviewed, workflow_inputs
from legislation_ingest_contract import (
    MAX_DECOMPRESSED_BYTES,
    ValidationError,
    authorize_reviewed_ingest,
    decode_payload_gzip_b64,
    document_payload_hash,
    normalize_document,
    parse_json_bytes,
    serialized_inputs_size,
    validate_payload,
    validate_workflow_inputs,
)


class ContractTests(unittest.TestCase):
    def test_frozen_golden_preimage_hash(self) -> None:
        document = raw_document()
        document["lastAmendedDate"] = None
        normalized = normalize_document(document, require_explicit_relations=True)
        self.assertEqual(
            document_payload_hash(normalized),
            "b236329de6b1b202dd39c05ebb3c66220ca446d121ece72fbb260b55a5f4cdc7",
        )
        self.assertEqual(normalized["sections"][0]["content"], "  exact\nbytes  ")

    def test_same_date_content_mutation_changes_hash(self) -> None:
        first = reviewed()
        changed = raw_document()
        changed["sections"][0]["content"] += " changed"
        second = reviewed(changed)
        self.assertEqual(first.last_amended_date, second.last_amended_date)
        self.assertNotEqual(first.review_hash, second.review_hash)

    def test_object_array_and_set_order_normalize_deterministically(self) -> None:
        first = raw_document()
        second = dict(reversed(list(first.items())))
        second["sections"] = list(reversed(copy.deepcopy(first["sections"])))
        next(
            section
            for section in second["sections"]
            if section["sectionId"] == "s 2"
        )["crossReferences"] = ["s 1", "s 3"]
        second["relatedDocs"] = ["qld/reg-a", "qld/reg-b"]
        self.assertEqual(reviewed(first).review_hash, reviewed(second).review_hash)

    def test_required_strings_trim_but_content_bytes_remain(self) -> None:
        document = raw_document()
        document["id"] = "  AU.Court/Act:Foo (2024)#1  "
        document["title"] = "  Planning Act 2016  "
        document["shortTitle"] = "   "
        normalized = normalize_document(document, require_explicit_relations=True)
        self.assertEqual(normalized["id"], "AU.Court/Act:Foo (2024)#1")
        self.assertEqual(normalized["title"], "Planning Act 2016")
        self.assertIsNone(normalized["shortTitle"])
        self.assertEqual(normalized["sections"][0]["content"], "  exact\nbytes  ")

    def test_live_document_type_extensions_are_valid(self) -> None:
        for value in ("local_law", "planning_scheme"):
            document = raw_document()
            document["type"] = value
            self.assertEqual(
                normalize_document(document, require_explicit_relations=True)["type"],
                value,
            )

    def test_blank_nullable_dates_and_url_normalize_to_null(self) -> None:
        document = raw_document()
        document["inForceDate"] = "  "
        document["repealedDate"] = "\t"
        document["legislationUrl"] = "   "
        normalized = normalize_document(document, require_explicit_relations=True)
        self.assertIsNone(normalized["inForceDate"])
        self.assertIsNone(normalized["repealedDate"])
        self.assertIsNone(normalized["legislationUrl"])

    def test_missing_relations_preserves_write_semantics(self) -> None:
        document = raw_document()
        document.pop("relatedDocs")
        value = reviewed(document)
        self.assertFalse(value.related_docs_explicit)
        self.assertNotIn("relatedDocs", value.document)
        self.assertNotIn("relatedDocs", value.payload["documents"][0])

    def test_duplicates_after_trim_are_rejected(self) -> None:
        for field in ("crossReferences",):
            document = raw_document()
            document["sections"][0][field] = ["s 1", " s 1 "]
            with self.assertRaisesRegex(ValidationError, "duplicate"):
                normalize_document(document, require_explicit_relations=True)
        document = raw_document()
        document["relatedDocs"] = ["qld/reg-a", " qld/reg-a "]
        with self.assertRaisesRegex(ValidationError, "duplicate"):
            normalize_document(document, require_explicit_relations=True)

    def test_duplicate_section_ids_and_orders_are_rejected(self) -> None:
        for field in ("sectionId", "order"):
            document = raw_document()
            document["sections"][1][field] = document["sections"][0][field]
            with self.assertRaisesRegex(ValidationError, "duplicate"):
                normalize_document(document, require_explicit_relations=True)

    def test_invalid_dates_url_enums_and_ascii_controls_are_rejected(self) -> None:
        mutations = [
            ("lastAmendedDate", "2025-02-29"),
            ("legislationUrl", "https://[invalid"),
            ("legislationUrl", "https://example.test:99999/act"),
            ("legislationUrl", "https://user:password@example.test/act"),
            ("type", "unknown"),
            ("id", "bad\nid"),
        ]
        for field, value in mutations:
            with self.subTest(field=field):
                document = raw_document()
                document[field] = value
                with self.assertRaises(ValidationError):
                    normalize_document(document, require_explicit_relations=True)
        document = raw_document()
        document["sections"][0]["status"] = "draft"
        with self.assertRaises(ValidationError):
            normalize_document(document, require_explicit_relations=True)

    def test_url_validator_is_a_conservative_subset_of_source_vectors(self) -> None:
        vectors = json.loads(
            (Path(__file__).parent / "fixtures" / "legislation_url_vectors.json")
            .read_text(encoding="utf-8")
        )
        for vector in vectors:
            with self.subTest(name=vector["name"]):
                self.assertFalse(
                    vector["runnerAccepts"] and not vector["sourceAccepts"],
                    "the runner fixture must never admit a Source-invalid URL",
                )
                document = raw_document()
                document["legislationUrl"] = vector["url"]
                if vector["runnerAccepts"]:
                    normalized = normalize_document(
                        document, require_explicit_relations=True
                    )
                    self.assertEqual(normalized["legislationUrl"], vector["url"])
                else:
                    with self.assertRaisesRegex(ValidationError, "legislationUrl"):
                        normalize_document(document, require_explicit_relations=True)

    def test_shared_source_boundaries_and_safe_url_subset(self) -> None:
        document = raw_document()
        document.update(
            {
                "jurisdiction": "x",
                "year": 1.0,
                "legislationUrl": "http://example.test/act#current",
                "number": "line one\nline two",
            }
        )
        document["sections"][0].update(
            {
                "content": "",
                "order": 2_147_483_647.0,
                "sectionId": "s" * 512,
            }
        )
        normalized = normalize_document(document, require_explicit_relations=True)
        self.assertEqual(normalized["jurisdiction"], "X")
        self.assertEqual(normalized["year"], 1)
        self.assertEqual(normalized["legislationUrl"], "http://example.test/act#current")
        self.assertEqual(normalized["number"], "line one\nline two")
        self.assertEqual(normalized["sections"][-1]["content"], "")
        self.assertEqual(normalized["sections"][-1]["order"], 2_147_483_647)

    def test_source_limits_for_sets_and_utf16_strings_are_enforced(self) -> None:
        document = raw_document()
        document["id"] = "😀" * 128
        normalize_document(document, require_explicit_relations=True)

        document["id"] += "a"
        with self.assertRaisesRegex(ValidationError, "256"):
            normalize_document(document, require_explicit_relations=True)

        document = raw_document()
        document["sections"][0]["crossReferences"] = [
            f"s {index}" for index in range(501)
        ]
        with self.assertRaisesRegex(ValidationError, "500"):
            normalize_document(document, require_explicit_relations=True)

        document = raw_document()
        document["relatedDocs"] = [f"qld/reg-{index}" for index in range(2_001)]
        with self.assertRaisesRegex(ValidationError, "2000"):
            normalize_document(document, require_explicit_relations=True)

    def test_nonfinite_json_number_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "non-finite"):
            parse_json_bytes(b'{"value":NaN}', label="test")

    def test_full_serialized_input_limit_boundary(self) -> None:
        overhead = len(b'{"x":""}')
        self.assertEqual(
            serialized_inputs_size({"x": "a" * (60_000 - overhead)}), 60_000
        )
        with self.assertRaisesRegex(ValidationError, "60000"):
            serialized_inputs_size({"x": "a" * (60_001 - overhead)})

    def test_document_lock_and_canonical_input_are_required(self) -> None:
        inputs = workflow_inputs()
        inputs["document_lock"] = "0" * 64
        with self.assertRaisesRegex(ValidationError, "document_lock"):
            validate_workflow_inputs(inputs)
        inputs = workflow_inputs()
        inputs["document_id"] = f" {inputs['document_id']} "
        with self.assertRaisesRegex(ValidationError, "already be canonical"):
            validate_workflow_inputs(inputs)

    def test_workflow_payload_must_match_exact_reviewed_manifest_entry(self) -> None:
        value = reviewed(terms=["reviewed phrase"])
        entry = {
            "documentId": value.document_id,
            "expectedSections": value.expected_sections,
            "lastAmendedDate": value.last_amended_date,
            "relatedDocsPolicy": "replace",
            "diagnosticTerms": ["reviewed phrase"],
            "normalizedPayloadSha256": value.review_hash,
        }
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.json"
            manifest.write_text(
                json.dumps({"version": 1, "builders": {"reviewed": entry}}),
                encoding="utf-8",
            )
            authorize_reviewed_ingest(value, manifest_path=manifest)
            entry["normalizedPayloadSha256"] = "0" * 64
            manifest.write_text(
                json.dumps({"version": 1, "builders": {"reviewed": entry}}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValidationError, "exact reviewed"):
                authorize_reviewed_ingest(value, manifest_path=manifest)

    def test_strict_base64_and_gzip_validation(self) -> None:
        for encoded in ("not base64", base64.b64encode(b"not gzip").decode("ascii")):
            with self.assertRaises(ValidationError):
                decode_payload_gzip_b64(encoded)

    def test_streamed_decompression_cap_rejects_bomb(self) -> None:
        bomb = gzip.compress(b"x" * (MAX_DECOMPRESSED_BYTES + 1), mtime=0)
        with self.assertRaisesRegex(ValidationError, "decompressed payload exceeds"):
            decode_payload_gzip_b64(base64.b64encode(bomb).decode("ascii"))


if __name__ == "__main__":
    unittest.main()
