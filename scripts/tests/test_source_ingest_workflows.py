from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
WORKFLOWS = REPOSITORY_ROOT / ".github" / "workflows"
SCRIPTS = REPOSITORY_ROOT / "sites" / "source" / "scripts"


# These tests pin the shape of `source-legislation-ingest.yml` and
# `cron-source.yml`, which still live in the tailor-app monorepo
# (tailor-app#5949 re-rooted the knowledge graph here without them). Outside
# that monorepo the files do not exist, so the suite skips rather than
# erroring in this repo's PR check (tailor-group#7).
@unittest.skipUnless(
    (WORKFLOWS / "source-legislation-ingest.yml").exists(),
    "workflow files live in the tailor-app monorepo",
)
class WorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ingest = (WORKFLOWS / "source-legislation-ingest.yml").read_text(
            encoding="utf-8"
        )

    def test_ingest_is_dispatch_only_and_main_trusted(self) -> None:
        on_block = self.ingest.split("permissions:", 1)[0]
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("push:", on_block)
        self.assertNotIn("pull_request:", on_block)
        self.assertEqual(self.ingest.count("github.ref == 'refs/heads/main'"), 2)
        self.assertEqual(self.ingest.count("ref: ${{ github.sha }}"), 2)
        self.assertNotIn("ref: ${{ inputs.", self.ingest)
        self.assertEqual(self.ingest.count("persist-credentials: false"), 2)

    def test_no_workflow_calls_the_retired_source_host(self) -> None:
        """`source.tailor.au` was retired by the #3690 cutover and now 308s.

        Every scheduled Source cron pointed at it and asserted `200`, so all of
        them failed silently for two months (#5582) — no legislation refresh, no
        staleness marking, no consensus sweep. Only `auth-check`, the one job
        operators run by hand, was wired to the live host, which is precisely
        why nobody noticed. This test is the thing that makes a silent
        reintroduction impossible.
        """
        offenders = sorted(
            path.name
            for path in WORKFLOWS.glob("*.yml")
            if "https://source.tailor.au" in path.read_text(encoding="utf-8")
        )
        self.assertEqual(offenders, [])

    def test_cron_jobs_share_one_live_base_url(self) -> None:
        cron = (WORKFLOWS / "cron-source.yml").read_text(encoding="utf-8")
        self.assertIn("SOURCE_URL: https://pact.tailor.au", cron)
        # A second base is what let the two drift apart in the first place.
        # Assert on the definition and the use, not on prose — the comment
        # naming the removed variable is the documentation that keeps it gone.
        self.assertNotIn("SOURCE_CANONICAL_URL:", cron)
        self.assertNotIn("env.SOURCE_CANONICAL_URL", cron)
        # Following a redirect would forward the cron secret to the redirect
        # target; the host is pinned instead.
        self.assertNotIn("curl -sL", cron)
        self.assertNotIn("--location", cron)

    def test_per_document_queue_never_cancels(self) -> None:
        self.assertIn(
            "group: source-legislation-ingest-prod-${{ inputs.document_lock }}",
            self.ingest,
        )
        self.assertIn("cancel-in-progress: false", self.ingest)
        self.assertIn("queue: max", self.ingest)

    def test_secret_is_available_only_after_validation(self) -> None:
        validate_job, ingest_job = self.ingest.split("\n  ingest:\n", 1)
        self.assertNotIn("environment:", validate_job)
        self.assertNotIn("SOURCE_INGEST_ADMIN_KEY", validate_job)
        self.assertIn("environment: source-prod-ingest", ingest_job)
        self.assertIn(
            "SOURCE_INGEST_ADMIN_KEY: ${{ secrets.SOURCE_INGEST_ADMIN_KEY }}",
            ingest_job,
        )
        self.assertNotIn("SOURCE_CRON_SECRET", self.ingest)
        runner = (SCRIPTS / "run_reviewed_legislation_ingest.py").read_text(
            encoding="utf-8"
        )
        self.assertLess(
            runner.index("authorize_reviewed_ingest(reviewed)"),
            runner.index("runner = ReviewedIngestRunner("),
        )

    def test_inputs_are_not_interpolated_into_shell(self) -> None:
        self.assertEqual(self.ingest.count("${{ inputs."), 2)
        self.assertNotIn("${{ inputs.document_id }}", self.ingest)
        runner = (SCRIPTS / "run_reviewed_legislation_ingest.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('os.environ.get("GITHUB_EVENT_PATH")', runner)
        self.assertNotIn("--event-path ${{", self.ingest)

    def test_admin_and_cron_secrets_are_split_without_fallback(self) -> None:
        deploy = (WORKFLOWS / "cd-source.yml").read_text(encoding="utf-8")
        infra = (WORKFLOWS / "infra-source-setup.yml").read_text(encoding="utf-8")
        cron = (WORKFLOWS / "cron-source.yml").read_text(encoding="utf-8")
        self.assertEqual(
            deploy.count("ADMIN_SECRET=${{ secrets.SOURCE_INGEST_ADMIN_KEY }}"), 2
        )
        self.assertEqual(
            deploy.count("ADMIN_SECRET: ${{ secrets.SOURCE_INGEST_ADMIN_KEY }}"), 4
        )
        self.assertEqual(
            infra.count("ADMIN_SECRET=${{ secrets.SOURCE_INGEST_ADMIN_KEY }}"), 1
        )
        self.assertRegex(
            infra,
            r"set-env-vars:\n(?:.*\n){0,6}\s+environment: prod",
        )
        self.assertNotRegex(
            deploy + infra,
            r"ADMIN_SECRET[^\n]*SOURCE_CRON_SECRET",
        )
        self.assertEqual(
            deploy.count("CRON_SECRET=${{ secrets.SOURCE_CRON_SECRET }}"), 2
        )
        self.assertEqual(
            infra.count("CRON_SECRET=${{ secrets.SOURCE_CRON_SECRET }}"), 1
        )
        # 9 cron jobs since #5425 added the consensus-sweep (auto-merge)
        # job — every job pins the source-prod-cron environment and the
        # cron secret, never the admin key (asserted below). This count
        # was stale at 8 after #5426 merged; #5459 is the first change to
        # re-run this suite in CI and fixes it forward.
        self.assertEqual(cron.count("environment: source-prod-cron"), 9)
        self.assertEqual(cron.count("secrets.SOURCE_CRON_SECRET"), 9)
        self.assertNotIn("SOURCE_INGEST_ADMIN_KEY", cron)

    def test_cron_auth_check_is_manual_only_and_read_only(self) -> None:
        cron = (WORKFLOWS / "cron-source.yml").read_text(encoding="utf-8")
        auth_job = cron.split("\n  auth-check:\n", 1)[1].split("\n  cleanup:\n", 1)[0]
        dispatch_options = cron.split("        options:\n", 1)[1].split("\nenv:\n", 1)[0]
        route = (
            REPOSITORY_ROOT
            / "sites"
            / "source"
            / "src"
            / "app"
            / "api"
            / "cron"
            / "auth-check"
            / "route.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("          - auth-check", dispatch_options)
        self.assertIn(
            "github.event_name == 'workflow_dispatch' && inputs.job == 'auth-check'",
            auth_job,
        )
        self.assertNotIn("github.event.schedule", auth_job)
        self.assertNotIn("inputs.job == 'all'", auth_job)
        self.assertIn("https://pact.tailor.au", cron)
        self.assertIn("/api/cron/auth-check", auth_job)
        self.assertNotIn("--request", auth_job)
        self.assertNotIn("-X ", auth_job)
        self.assertIn('export const dynamic = "force-dynamic"', route)
        self.assertNotIn("@/lib/db", route)

    def test_source_pr_gate_covers_tests_build_and_workflow_lint(self) -> None:
        gate = (WORKFLOWS / "source-pr-check.yml").read_text(encoding="utf-8")
        for required in (
            "npm ci --no-audit --no-fund",
            "python -m unittest discover",
            "npm test",
            "npm run build",
            "actionlint-bin",
            '"sites/source/**"',
            '".github/workflows/source-*.yml"',
            '".github/workflows/cron-source.yml"',
            ".github/workflows/cron-source.yml",
        ):
            self.assertIn(required, gate)

    def test_manifest_contains_reviewed_builders(self) -> None:
        manifest = json.loads(
            (SCRIPTS / "reviewed_legislation_builders.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            set(manifest["builders"]),
            {
                "customer-identity-authentication-determination-2022",
                "customer-service-guarantee-standard-2023",
                "financial-hardship-standard-2024",
                "international-mobile-roaming-determination-2019",
                "mobile-network-coverage-maps-standard-2026",
                "mobile-number-pre-porting-standard-2020",
                "nbn-consumer-information-standard-2018",
                "payphones-determination-2022",
                "planning-act-2016",
                "telecommunications-cabling-provider-rules-2025",
                "telecommunications-consumer-protection-act-1999",
                "telecommunications-numbering-plan-2025",
            },
        )
        for entry in manifest["builders"].values():
            self.assertRegex(entry["relativePath"], r"^build_[a-z0-9_]+_payload\.py$")
            self.assertRegex(entry["builderSha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(entry["rawPayloadSha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(
                entry["normalizedPayloadSha256"], r"^[0-9a-f]{64}$"
            )
            self.assertEqual(entry["relatedDocsPolicy"], "preserve")
            self.assertIsInstance(entry["requiredFiles"], dict)
            self.assertTrue(entry["requiredFiles"])


if __name__ == "__main__":
    unittest.main()
