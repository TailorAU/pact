#!/usr/bin/env node
/**
 * Publish-time gate for @pact-protocol/conformance-vectors.
 *
 * The package ships the v2.3 vector corpus. This asserts that what the package
 * ships is EXACTLY what the repo's canonical inventory says exists — in both
 * directions, so neither a silently added vector nor a silently dropped one
 * can reach the registry.
 *
 * The inventory is NOT redefined here. It is read from
 * `.github/conformance/v2.3-reference-server-expected-failures.json`, the same
 * manifest `tools/check-conformance-expected-failures.mjs` gates the CI run
 * against (pact #63). One source of truth, two consumers: the run gate proves
 * the vectors still behave as declared; this proves the published tarball
 * contains that same set. A second hand-maintained list would drift from the
 * first, which is the failure mode the exact-set manifest exists to remove.
 *
 * No YAML parsing and no dependencies: a vector ID is `<family>/<stem>` or
 * `<family>/<stem>/<inner-id>` when one file carries several vectors (e.g.
 * `core/join/basic` lives in `core/join.yaml`), so the file each ID belongs to
 * is resolvable by path alone.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "..", "..", "..");
const manifestPath = join(
  repoRoot,
  ".github",
  "conformance",
  "v2.3-reference-server-expected-failures.json",
);

if (!existsSync(manifestPath)) {
  console.error(
    `FAIL: canonical inventory not found at ${manifestPath}.\n` +
      "This gate runs from a repo checkout, not from an installed package — " +
      "the manifest is deliberately not shipped in the tarball.",
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const declaredIds = manifest.expected_vector_ids;

if (!Array.isArray(declaredIds) || declaredIds.length === 0) {
  console.error("FAIL: manifest carries no expected_vector_ids.");
  process.exit(1);
}

/** Every .yaml under the directories the package actually ships. */
function shippedVectorFiles() {
  const found = [];
  for (const top of ["core", "extended"]) {
    const base = join(packageRoot, top);
    if (!existsSync(base)) continue;
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".yaml")) {
          found.push(relative(packageRoot, full).split("\\").join("/"));
        }
      }
    };
    walk(base);
  }
  return found.sort();
}

const files = shippedVectorFiles();
const fileStems = new Set(files.map((f) => f.replace(/\.yaml$/, "")));

// Direction 1: every declared vector resolves to a file the package ships.
// `<family>/<stem>` maps to `<family>/<stem>.yaml`; `<family>/<stem>/<inner>`
// maps to `<family>/<stem>.yaml` too, so try the ID and then its parent.
const unresolved = declaredIds.filter((id) => {
  if (fileStems.has(id)) return false;
  const parent = id.slice(0, id.lastIndexOf("/"));
  return !(parent && fileStems.has(parent));
});

// Direction 2: every shipped file is claimed by at least one declared vector.
const unclaimed = [...fileStems].filter(
  (stem) => !declaredIds.some((id) => id === stem || id.startsWith(`${stem}/`)),
).sort();

const problems = [];
if (unresolved.length) {
  problems.push(
    `Declared in the manifest but MISSING from the package (${unresolved.length}):\n  ` +
      unresolved.join("\n  "),
  );
}
if (unclaimed.length) {
  problems.push(
    `Shipped by the package but ABSENT from the manifest (${unclaimed.length}):\n  ` +
      unclaimed.join("\n  "),
  );
}

if (problems.length) {
  console.error("FAIL: package contents and canonical inventory disagree.\n");
  console.error(problems.join("\n\n"));
  console.error(
    "\nFix the cause, not this script: either add the vector to the manifest " +
      "(and decide its expected outcome) or remove it from the corpus. The " +
      "inventory is exact by design — see the manifest's own `context` field.",
  );
  process.exit(1);
}

console.log(
  `OK: ${files.length} vector files carry all ${declaredIds.length} declared vectors, ` +
    "and nothing else.",
);
