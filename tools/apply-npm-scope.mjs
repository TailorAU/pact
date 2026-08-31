#!/usr/bin/env node
/**
 * apply-npm-scope.mjs — execute the #5 scope rename in one pass, AFTER the
 * npm org exists.
 *
 * Sequencing (docs/npm-scope-decision.md + #5 decision comment, 2026-08-05):
 * the rename deliberately FOLLOWS org creation, because availability of the
 * first-choice scope (pact-spec) only confirms at creation time, with @pact_
 * (already Tailor-owned) as the fallback. Running this before the org exists
 * violates AGENTS.md rule 6 — don't.
 *
 * Usage:
 *   node tools/apply-npm-scope.mjs @pact-spec         # dry-run (default)
 *   node tools/apply-npm-scope.mjs @pact-spec --write
 *
 * What it does (per the decision comment):
 *   RENAMES (name field only, lockfile name fields patched to match):
 *     cli/                         @pact-protocol/cli                -> <scope>/cli
 *     mcp/                         @pact-protocol/mcp                -> <scope>/mcp
 *     reference-server/            @pact-protocol/reference-server   -> <scope>/reference-server
 *     spec/v2.1/conformance/runner @pact-protocol/conformance-runner -> <scope>/conformance-runner
 *     spec/v2.3/conformance        @pact-protocol/conformance-vectors -> <scope>/conformance-vectors
 *   DOES NOT TOUCH (frozen lines — appends an ERRATA note instead):
 *     spec/v2.0/conformance/runner, spec/v2.2/conformance/runner
 *   PRINTS a checklist of the editorial follow-ups a human/PR must still do
 *   (AGENTS.md rule 6 supersession, README/site install restoration reversing
 *   #46, RELEASING.md scope mentions) — those are prose judgement, not sed.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scope = process.argv[2];
const write = process.argv.includes("--write");

if (!scope || !/^@[a-z0-9][a-z0-9-_]*$/.test(scope)) {
  console.error("Usage: node tools/apply-npm-scope.mjs <@scope> [--write]");
  console.error("  e.g. node tools/apply-npm-scope.mjs @pact-spec --write");
  process.exit(2);
}

const OLD = "@pact-protocol";
const RENAME = [
  "cli",
  "mcp",
  "reference-server",
  "spec/v2.1/conformance/runner",
  // The v2.3 vector corpus (#5536 ruling). Not frozen — v2.3 is the
  // maintained line — so a scope rename must carry it like the others.
  "spec/v2.3/conformance",
];
const FROZEN = ["spec/v2.0/conformance", "spec/v2.2/conformance"];

let changes = 0;

function patchJsonName(relDir) {
  for (const file of ["package.json", "package-lock.json"]) {
    const path = resolve(root, relDir, file);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    if (!raw.includes(`${OLD}/`)) continue;
    // Rename ONLY name identity fields, never dependency specs (there are no
    // internal @pact-protocol dependencies — verified 2026-08-11; the guard
    // below fails loudly if that ever changes rather than renaming blind).
    const next = raw.replaceAll(`"${OLD}/`, `"${scope}/`);
    const depHit = /"dependencies"[\s\S]*?@pact-protocol\//.test(next);
    if (depHit) {
      console.error(`REFUSING: ${relDir}/${file} has an ${OLD}/* dependency — update this script's assumptions first.`);
      process.exit(1);
    }
    console.log(`${write ? "RENAMED" : "would rename"}: ${relDir}/${file}`);
    if (write) writeFileSync(path, next);
    changes++;
  }
}

function appendErrata(relDir) {
  const path = resolve(root, relDir, "ERRATA.md");
  const note =
    `\n## npm scope (issue #5, applied ${new Date().toISOString().slice(0, 10)})\n\n` +
    `The runner in this FROZEN line is named \`${OLD}/conformance-runner\` as-released. ` +
    `That npm scope is owned by an unrelated third party and was never published by this project. ` +
    `The maintained runner is published as \`${scope}/conformance-runner\` (see spec/v2.1/conformance/runner). ` +
    `The frozen name is historical only — do not install it.\n`;
  console.log(`${write ? "ERRATA appended" : "would append ERRATA"}: ${relDir}/ERRATA.md`);
  if (write) {
    if (existsSync(path)) appendFileSync(path, note);
    else writeFileSync(path, `# Errata\n${note}`);
  }
  changes++;
}

for (const dir of RENAME) patchJsonName(dir);
for (const dir of FROZEN) appendErrata(dir);

console.log(`\n${write ? "Applied" : "Dry-run:"} ${changes} change(s) for scope ${scope}.`);
console.log(`
STILL MANUAL (prose, belongs in the same rename PR):
  1. AGENTS.md rule 6 — supersede: scope is decided and applied; renames done.
  2. README / docs/integration-guide.md / site + pact.tailor.au — restore real
     install commands under ${scope} (reversing #46's from-source fallback).
  3. RELEASING.md / RELEASING_v2.2.md — update scope mentions + preflight.
  4. SECURITY.md / README — permanent note that ${OLD} on npm is UNAFFILIATED.
  5. Then: publish via .github/workflows/publish-packages.yml (scope-neutral).
`);
