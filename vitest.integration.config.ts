import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * #5599 B-0 — Vitest bootstrap for the Source KG real-Postgres integration
 * canaries (the `.itest.ts` suite under `src/`).
 *
 * Deliberately a SIBLING of vitest.config.ts rather than a merged project:
 * `npm test` (the mock/unit suite over `.test.ts`) must stay byte-identical,
 * and vitest's `mergeConfig` CONCATENATES `test.include` arrays instead of
 * replacing them — a merge would leak the unit patterns into this run.
 * Same alias + environment as the unit config.
 *
 * The suite this config runs SKIPS itself loudly when DATABASE_URL is unset
 * (see src/lib/db.itest.ts) — locally, without Postgres, `npm run
 * test:integration` is a no-op pass. In CI the `kg-integration` job in
 * .github/workflows/source-pr-check.yml provides a postgres:16-alpine
 * service container and sets DATABASE_URL.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.itest.ts"],
    environment: "node",
    // #5599 PR-A — the suite is now more than one file, and every file
    // bootstraps + writes the SAME service-container database. Run files
    // sequentially: concurrent cold-start initSchema DDL races in Postgres
    // (pg_type unique-violation on simultaneous CREATE TABLE IF NOT EXISTS)
    // and cross-file writes would make the canaries flaky for nothing.
    fileParallelism: false,
    // Verbose reporter: these are CANARIES — the CI log should name every
    // pinned semantic individually, so a #5599 flip is visible per-canary
    // in the job output, not collapsed into one per-file line.
    reporters: ["verbose"],
    // initSchema's self-bootstrap runs ~150 DDL statements plus the
    // curriculum seed against a cold service container — give tests and
    // hooks a longer leash than the unit defaults.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
