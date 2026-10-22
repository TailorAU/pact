from __future__ import annotations

import json
import unittest

from legislation_ingest_contract import document_payload_hash
from helpers import (
    FakeTransport,
    canonical_response,
    json_response,
    not_found_response,
    post_success,
    raw_document,
    reviewed,
)
from run_reviewed_legislation_ingest import (
    MAX_CANONICAL_RESPONSE_BYTES,
    MAX_POST_ATTEMPTS,
    MAX_POST_RESPONSE_BYTES,
    MAX_SEARCH_RESPONSE_BYTES,
    HttpResponse,
    ReviewedIngestRunner,
    RunnerError,
    TransportFailure,
)


def mismatch_document():
    document = raw_document()
    document["sections"][0]["content"] += " old"
    return document


class RunnerTests(unittest.TestCase):
    def make_runner(self, reviewed_value, transport, output=None, sleeps=None):
        return ReviewedIngestRunner(
            reviewed_value,
            admin_key="super-secret-admin-key-0123456789abcdef",
            correlation_id="source-ingest-123-1",
            transport=transport,
            sleep=(sleeps if sleeps is not None else []).append,
            base_url="https://source.example.test",
            output=(output if output is not None else []).append,
        )

    def test_exact_state_skips_post_and_search_miss_is_warning_only(self) -> None:
        value = reviewed(terms=["secret diagnostic phrase"])
        output: list[str] = []
        transport = FakeTransport(
            [
                canonical_response(value),
                json_response(200, {"results": [], "total": 0}),
            ]
        )
        result = self.make_runner(value, transport, output=output).run()
        self.assertEqual(result, "skipped")
        self.assertEqual([call["method"] for call in transport.calls], ["GET", "GET"])
        self.assertTrue(any("warning" in line for line in output))
        self.assertFalse(any("secret diagnostic phrase" in line for line in output))
        expected_hash = document_payload_hash(value.document)
        self.assertIn(
            "exact-skip "
            f"stored_canonical_hash={expected_hash} "
            f"expected_canonical_hash={expected_hash}",
            output,
        )

    def test_omitted_relations_hydrate_existing_complete_state_and_skip(self) -> None:
        write_document = raw_document()
        write_document.pop("relatedDocs")
        value = reviewed(write_document)
        stored_document = raw_document()
        transport = FakeTransport([canonical_response(value, stored_document)])
        self.assertEqual(self.make_runner(value, transport).run(), "skipped")
        self.assertFalse(any(call["method"] == "POST" for call in transport.calls))

    def test_omitted_relations_on_new_document_hydrate_empty_and_preserve_post(self) -> None:
        write_document = raw_document()
        write_document.pop("relatedDocs")
        value = reviewed(write_document)
        absent = not_found_response(value.document_id)
        transport = FakeTransport(
            [absent, absent, post_success(value), canonical_response(value)]
        )
        self.assertEqual(self.make_runner(value, transport).run(), "ingested")
        post = next(call for call in transport.calls if call["method"] == "POST")
        posted = json.loads(post["body"])
        self.assertNotIn("relatedDocs", posted["documents"][0])

    def test_unavailable_exact_state_blocks_preserve_before_post(self) -> None:
        write_document = raw_document()
        write_document.pop("relatedDocs")
        value = reviewed(write_document)
        transport = FakeTransport(
            [json_response(500, {"error": "canonical_state_invalid"})] * 3
        )
        with self.assertRaisesRegex(RunnerError, "could not be established"):
            self.make_runner(value, transport).run()
        self.assertFalse(any(call["method"] == "POST" for call in transport.calls))

    def test_explicit_empty_relations_clear_and_verify_complete_state(self) -> None:
        clear_document = raw_document()
        clear_document["relatedDocs"] = []
        value = reviewed(clear_document)
        stored_document = raw_document()
        mismatch = canonical_response(value, stored_document)
        transport = FakeTransport(
            [mismatch, mismatch, post_success(value), canonical_response(value)]
        )
        self.assertEqual(self.make_runner(value, transport).run(), "ingested")
        post = next(call for call in transport.calls if call["method"] == "POST")
        self.assertEqual(json.loads(post["body"])["documents"][0]["relatedDocs"], [])

    def test_same_date_content_change_posts_then_verifies_exact(self) -> None:
        value = reviewed()
        output: list[str] = []
        transport = FakeTransport(
            [
                canonical_response(value, mismatch_document()),
                canonical_response(value, mismatch_document()),
                post_success(value),
                canonical_response(value),
            ]
        )
        result = self.make_runner(value, transport, output=output).run()
        self.assertEqual(result, "ingested")
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 1)
        post = next(call for call in transport.calls if call["method"] == "POST")
        self.assertEqual(
            post["url"],
            "https://source.example.test/api/axiom/legislation/ingest",
        )
        self.assertEqual(post["body"], value.payload_bytes)
        self.assertEqual(
            post["headers"]["X-Admin-Key"],
            "super-secret-admin-key-0123456789abcdef",
        )
        # tailor-group#35: the reviewed assertion rides only the POST.
        self.assertEqual(post["headers"]["X-Ingest-Source"], "reviewed")
        self.assertEqual(post["response_cap"], MAX_POST_RESPONSE_BYTES)
        self.assertTrue(
            all(
                "X-Admin-Key" not in call["headers"]
                and "X-Ingest-Source" not in call["headers"]
                for call in transport.calls
                if call["method"] == "GET"
            )
        )
        expected_hash = document_payload_hash(value.document)
        self.assertIn(
            "post-verified "
            f"stored_canonical_hash={expected_hash} "
            f"expected_canonical_hash={expected_hash}",
            output,
        )

    def test_ambiguous_post_stored_is_not_retried(self) -> None:
        value = reviewed()
        output: list[str] = []
        transport = FakeTransport(
            [
                canonical_response(value, mismatch_document()),
                canonical_response(value, mismatch_document()),
                TransportFailure("hidden network detail"),
                canonical_response(value),
            ]
        )
        self.assertEqual(
            self.make_runner(value, transport, output=output).run(), "reconciled"
        )
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 1)
        self.assertTrue(
            any(line.startswith("ambiguous-post-reconciled stored_canonical_hash=") for line in output)
        )

    def test_ambiguous_post_absent_retries_only_after_final_poll(self) -> None:
        value = reviewed()
        absent = not_found_response(value.document_id)
        transport = FakeTransport(
            [
                absent,
                absent,
                json_response(500, {"error": "unknown"}),
                absent,
                absent,
                absent,
                absent,
                absent,
                post_success(value),
                canonical_response(value),
            ]
        )
        sleeps: list[float] = []
        self.assertEqual(
            self.make_runner(value, transport, sleeps=sleeps).run(), "ingested"
        )
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 2)
        self.assertEqual(sleeps, [2.0, 5.0, 10.0, 2.0])

    def test_nonretryable_post_status_fails_without_second_post(self) -> None:
        value = reviewed()
        absent = not_found_response(value.document_id)
        transport = FakeTransport([absent, absent, json_response(400, {"error": "bad"})])
        with self.assertRaisesRegex(RunnerError, "non-retryable HTTP 400"):
            self.make_runner(value, transport).run()
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 1)

    def test_success_status_with_persistent_mismatch_fails_closed(self) -> None:
        value = reviewed()
        mismatch = canonical_response(value, mismatch_document())
        transport = FakeTransport(
            [mismatch, mismatch, post_success(value), mismatch, mismatch, mismatch, mismatch]
        )
        with self.assertRaisesRegex(RunnerError, "did not converge"):
            self.make_runner(value, transport).run()
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 1)

    def test_malformed_success_envelope_fails_without_retry(self) -> None:
        value = reviewed()
        absent = not_found_response(value.document_id)
        malformed = json_response(
            200,
            {
                "ingested": True,
                "documents": [
                    {
                        "id": value.document_id,
                        "title": value.document["title"],
                        "sectionsInserted": value.expected_sections,
                    }
                ],
                "message": "not a valid numeric envelope",
            },
        )
        transport = FakeTransport([absent, absent, malformed])
        with self.assertRaisesRegex(RunnerError, "ingest response"):
            self.make_runner(value, transport).run()
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 1)

    def test_retry_cap_is_three_posts(self) -> None:
        value = reviewed()
        absent = not_found_response(value.document_id)
        responses = [absent]
        for _ in range(MAX_POST_ATTEMPTS):
            responses.extend(
                [absent, json_response(503, {"error": "unknown"}), absent, absent, absent, absent]
            )
        transport = FakeTransport(responses)
        with self.assertRaisesRegex(RunnerError, "retry cap"):
            self.make_runner(value, transport).run()
        self.assertEqual([call["method"] for call in transport.calls].count("POST"), 3)

    def test_newer_stored_date_blocks_post(self) -> None:
        value = reviewed()
        newer = mismatch_document()
        newer["lastAmendedDate"] = "2026-04-28"
        transport = FakeTransport([canonical_response(value, newer)])
        with self.assertRaisesRegex(RunnerError, "newer"):
            self.make_runner(value, transport).run()
        self.assertFalse(any(call["method"] == "POST" for call in transport.calls))

    def test_wrong_id_blocks_before_relation_hydration_or_post(self) -> None:
        for related_docs_explicit in (False, True):
            with self.subTest(related_docs_explicit=related_docs_explicit):
                write_document = raw_document()
                if not related_docs_explicit:
                    write_document.pop("relatedDocs")
                value = reviewed(write_document)
                wrong_document = raw_document()
                wrong_document["id"] = "qld/act-wrong-id"
                wrong_document["lastAmendedDate"] = "2026-04-28"
                wrong_response = canonical_response(value, wrong_document)
                transport = FakeTransport([wrong_response] * 3)

                with self.assertRaisesRegex(RunnerError, "could not be established"):
                    self.make_runner(value, transport).run()

                self.assertFalse(
                    any(call["method"] == "POST" for call in transport.calls)
                )

    def test_response_caps_and_uncached_exact_query(self) -> None:
        value = reviewed(terms=["diagnostic"])
        transport = FakeTransport(
            [
                canonical_response(value),
                json_response(200, {"results": []}),
            ]
        )
        self.make_runner(value, transport).run()
        exact, search = transport.calls
        self.assertEqual(exact["response_cap"], MAX_CANONICAL_RESPONSE_BYTES)
        self.assertEqual(
            exact["url"],
            "https://source.example.test/api/axiom/legislation"
            "?id=qld%2Fact-2016-025&format=canonical",
        )
        self.assertIn("Cache-Control", exact["headers"])
        self.assertEqual(search["response_cap"], MAX_SEARCH_RESPONSE_BYTES)
        self.assertIn("limit=200", search["url"])

    def test_no_store_must_be_an_exact_cache_control_directive(self) -> None:
        value = reviewed()
        valid = canonical_response(value)
        misleading = HttpResponse(
            valid.status, {"cache-control": "private, x-no-store"}, valid.body
        )
        transport = FakeTransport([misleading, misleading, misleading])
        with self.assertRaisesRegex(RunnerError, "could not be established"):
            self.make_runner(value, transport).run()
        self.assertFalse(any(call["method"] == "POST" for call in transport.calls))

    def test_safe_output_never_contains_key_payload_or_terms(self) -> None:
        value = reviewed(terms=["private term"])
        output: list[str] = []
        transport = FakeTransport(
            [canonical_response(value), json_response(500, {"secret": "response"})]
        )
        self.make_runner(value, transport, output=output).run()
        combined = "\n".join(output)
        self.assertNotIn("super-secret-admin-key-0123456789abcdef", combined)
        self.assertNotIn("Meaning.", combined)
        self.assertNotIn("private term", combined)
        self.assertNotIn("response", combined)


if __name__ == "__main__":
    unittest.main()
