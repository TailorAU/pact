import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  APPLY_GUARD_ENFORCED,
  AUTHORIZATION_PROOF_SUPPORTED,
  EXECUTION_CAPABILITY,
  KG_CLASSIFIED_RESOURCE_TYPES,
  resolveResourceType,
} from "./effect-class";
import { CONSENSUS_RATIO } from "./db";
import { INDEPENDENCE_CONFIG } from "./independence";
import { VERIFIED_TOPIC_STATUSES } from "./consensus-gate";
import { spawnSync } from "child_process";
import {
  CONFORMANCE_RESULTS_PATH,
  EPISTEMICS_EXTENSION,
  PUBLIC_BASE_URL,
  buildPactProfile,
} from "./pact-profile";
import type { RetentionPolicy } from "./pact-profile";
import {
  RESULTS_ARTIFACT_NAME,
  flattenDispositions,
  type AcceptanceManifest,
  type CorpusFixture,
  type DispositionsManifest,
} from "./pact-conformance-report";
import { UNCHAINED_EVENTS_PURGED, UNCHAINED_EVENT_RETENTION_DAYS } from "./retention";

/**
 * Drift gate for the published conformance profile (#5541).
 *
 * `PACT_CONFORMANCE.md` is the KG's public conformance claim. The #5488 W6
 * parity audit found it understating the implementation for months — two
 * capabilities declared `false` that were fully built, 6 of 28 API routes
 * listed, and consensus thresholds frozen at their April 2026 values while
 * the dependency gate (#2888/#3691) and independence-class quorums
 * (#5459/#5464) had superseded them.
 *
 * A profile nobody can drift-check drifts. This suite re-derives the claim
 * from the implementation on every run: it parses the JSON block, walks
 * `src/app/api/pact/` for every route file, and reads the thresholds out of
 * the modules that enforce them. Add a route, flip a capability, or move a
 * threshold without updating the profile, and this fails.
 */

const SOURCE_ROOT = path.resolve(__dirname, "..", "..");
const PROFILE_PATH = path.join(SOURCE_ROOT, "PACT_CONFORMANCE.md");
const PACT_ROUTES_DIR = path.join(SOURCE_ROOT, "src", "app", "api", "pact");
const SRC_DIR = path.join(SOURCE_ROOT, "src");
/** This file names the tokens it forbids, so it excludes itself from its greps. */
const THIS_FILE = "pact-conformance-profile.test.ts";

const profileMarkdown = fs.readFileSync(PROFILE_PATH, "utf8");

interface DeclaredGapJson {
  area: string;
  tracking?: string;
  statement?: string;
}

/**
 * The WHOLE served document, not a hand-picked slice of it.
 *
 * The previous shape modelled seven keys and left `retentionPolicy`,
 * `provenance`, `extensions` and `declaredGaps` unmodelled — so a peer could
 * edit `"hashAlg": "sha256-jcs@1"` to `"md5"` in the block and `npm test`
 * stayed green. Every key the builder emits is modelled here because every key
 * is now compared.
 */
interface ProfileJson {
  name: string;
  version: string;
  specVersion: string;
  conformanceLevel: string;
  resourceTypes: {
    type: string;
    effectClass?: string;
    humanAttestation?: string;
    terminalStates?: string[];
  }[];
  retentionPolicy: Record<string, unknown>;
  provenance: Record<string, unknown>;
  capabilities: Record<string, boolean>;
  endpoints: Record<string, string>;
  extensions: Record<string, unknown>;
  declaredGaps: DeclaredGapJson[];
}

function parseProfileJson(): ProfileJson {
  const block = profileMarkdown.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!block) throw new Error("PACT_CONFORMANCE.md carries no ```json implementation-profile block");
  return JSON.parse(block[1]) as ProfileJson;
}

/** Every .ts/.tsx under src/, so an invariant can be asserted repo-wide. */
function allSourceFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

interface RouteRow {
  readonly path: string;
  readonly methods: string[];
}

/**
 * The HTTP methods a Next route module actually exports. Both shapes count:
 * `export async function GET` (27 of the 28) and `export const GET` (the
 * `topics/{topicId}` alias, which re-exports the `{topicId}` handler).
 */
function routeMethods(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  return HTTP_METHODS.filter(
    (method) =>
      new RegExp(`export\\s+(?:async\\s+function|function|const|let|var)\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`).test(source)
  );
}

/**
 * Every `api/pact` route, as the wire path it is served at plus the methods
 * its module exports. Directory segments in Next's `[param]` form become
 * `{param}` so they read the way the profile's API table writes them.
 */
function discoverPactRoutes(dir: string = PACT_ROUTES_DIR, prefix = "/api/pact"): RouteRow[] {
  const out: RouteRow[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const segment = entry.name.replace(/^\[(\.{3})?(.+)\]$/, "{$2}");
      out.push(...discoverPactRoutes(path.join(dir, entry.name), `${prefix}/${segment}`));
    } else if (entry.name === "route.ts") {
      out.push({ path: prefix, methods: routeMethods(path.join(dir, entry.name)) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const API_TABLE_HEADER = "| Method(s) | Path | Purpose |";

/**
 * Every ROW of the profile's API-mapping tables, as `{path, methods}`.
 *
 * Keyed on the table HEADER, never on a path-shaped substring. That
 * distinction is the whole repair: the previous check asked only whether the
 * route string appeared ANYWHERE in the document, which `/api/pact/{topicId}`
 * satisfied by prefix for most rows and which `endpoints.poll` inside the JSON
 * block satisfied on its own for the events route.
 */
function parseApiTable(markdown: string): RouteRow[] {
  const rows: RouteRow[] = [];
  let inTable = false;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === API_TABLE_HEADER) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^\|\s*-{3,}/.test(trimmed)) continue;
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const routePath = cells.length > 1 ? cells[1].match(/`([^`]+)`/) : null;
    if (!routePath) {
      inTable = false;
      continue;
    }
    rows.push({ path: routePath[1], methods: [...cells[0].matchAll(/`([A-Z]+)`/g)].map((m) => m[1]) });
  }
  return rows;
}

/** Every value-level divergence between two JSON documents, as dotted paths. */
function jsonDiff(document: unknown, served: unknown, at = "$"): string[] {
  if (JSON.stringify(document) === JSON.stringify(served)) return [];
  if (
    Array.isArray(document) &&
    Array.isArray(served) &&
    document.length === served.length
  ) {
    return document.flatMap((entry, i) => jsonDiff(entry, served[i], `${at}[${i}]`));
  }
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (isPlainObject(document) && isPlainObject(served)) {
    const keys = [...new Set([...Object.keys(document), ...Object.keys(served)])].sort();
    return keys.flatMap((k) => jsonDiff(document[k], served[k], `${at}.${k}`));
  }
  return [`${at}: document ${JSON.stringify(document)} != served ${JSON.stringify(served)}`];
}

const profile = parseProfileJson();
const pactRoutes = discoverPactRoutes();
const pactPaths = pactRoutes.map((r) => r.path);
const documentedRoutes = parseApiTable(profileMarkdown);
/**
 * The PRODUCTION rendering (#5567): the Markdown block IS the prod wire, and
 * on production the deploy always shipped the CI-produced conformance
 * results document (`cd-kg.yml` refuses to build the image without a
 * validated one), so the route serves `buildPactProfile(PUBLIC_BASE_URL, {
 * conformanceReportShipped: true })` there. An origin that did not ship it
 * (local, preview, a cell) serves the same document minus
 * `endpoints.conformanceResults` — asserted below, never a 404 (#5539).
 */
const generatedProfile = buildPactProfile(PUBLIC_BASE_URL, { conformanceReportShipped: true });

/**
 * `buildPactProfile()` rendered the way the Markdown block is PERMITTED to
 * render it — the one declared departure applied and nothing else. Anything
 * the block says that this object does not is drift.
 *
 * The departure — `declaredGaps[].statement` is abridged away for length.
 *
 * #5539 retired the former departure 1 (`specVersion` deliberately held at
 * the stale v1.1 while the version claim had no evidence): the block now
 * carries the served value and is compared like every other key, so this
 * function no longer overrides it.
 */
function servedAsDocumentMayRenderIt(): Record<string, unknown> {
  const served = JSON.parse(JSON.stringify(generatedProfile)) as Record<string, unknown>;
  served.declaredGaps = (served.declaredGaps as DeclaredGapJson[]).map((gap) =>
    gap.tracking === undefined ? { area: gap.area } : { area: gap.area, tracking: gap.tracking }
  );
  return served;
}

/**
 * The remainder of one header blockquote line, e.g. `headerLine(md, "PACT
 * Spec Version")` over `> **PACT Spec Version:** v2.3` returns `"v2.3"`.
 * Pure over a string so the #5539 fixtures below can prove each pin bites;
 * `null` when the document carries no such line, so a renamed header can
 * never pass vacuously.
 */
function headerLine(markdown: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = markdown.match(new RegExp(`^>\\s*\\*\\*${escaped}:\\*\\*\\s*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

describe("published profile — capabilities match the implementation (#5541)", () => {
  it("inviteTokens is true, and the mint + redeem + exhaustion path exists", () => {
    expect(profile.capabilities.inviteTokens).toBe(true);
    const joinToken = fs.readFileSync(
      path.join(PACT_ROUTES_DIR, "[topicId]", "join-token", "route.ts"),
      "utf8"
    );
    expect(joinToken).toContain("SELECT * FROM invite_tokens WHERE token = ? AND topic_id = ?");
    expect(joinToken).toContain("Invite token exhausted");
    // Minted on topic creation — a redeem path with no mint would be a
    // half-capability, and declaring it true would be the same defect in the
    // other direction.
    const topics = fs.readFileSync(path.join(PACT_ROUTES_DIR, "topics", "route.ts"), "utf8");
    expect(topics).toContain("INSERT INTO invite_tokens");
  });

  it("structuredNegotiation is true, and every §10 primitive is served", () => {
    expect(profile.capabilities.structuredNegotiation).toBe(true);
    for (const primitive of ["intents", "constraints", "salience", "dependencies", "assumptions"]) {
      expect(pactPaths).toContain(`/api/pact/{topicId}/${primitive}`);
    }
  });

  it("mediatedCommunication and informationBarriers stay false — nothing implements them", () => {
    expect(profile.capabilities.mediatedCommunication).toBe(false);
    expect(profile.capabilities.informationBarriers).toBe(false);
    // A §13 mediator surface would show up as a route; none does.
    expect(pactPaths.filter((r) => /mediat|barrier|clearance/i.test(r))).toEqual([]);
  });

  it("the §25 capability flags are read from the module that enforces them", () => {
    expect(profile.capabilities.applyGuard).toBe(APPLY_GUARD_ENFORCED);
    expect(profile.capabilities.authorizationProof).toBe(AUTHORIZATION_PROOF_SUPPORTED);
    expect(profile.capabilities.executionCapability).toBe(EXECUTION_CAPABILITY);
  });

  it("keeps authorizationProof false — refusing unsupported fields is not proof support", () => {
    expect(AUTHORIZATION_PROOF_SUPPORTED).toBe(false);
    expect(profile.capabilities.authorizationProof).toBe(false);
    expect(generatedProfile.capabilities.authorizationProof).toBe(false);
    expect(profileMarkdown).toContain(
      "the KG performs no §17.6 `authorization_proof` verification of any kind"
    );
  });

  it("advertises exactly the types the §25.6 filter lets it, with the resolver's classification", () => {
    expect(profile.resourceTypes.map((t) => t.type)).toEqual(
      generatedProfile.resourceTypes.map((t) => t.type)
    );
    for (const declared of profile.resourceTypes) {
      const registered = KG_CLASSIFIED_RESOURCE_TYPES.find((t) => t.type === declared.type);
      expect(registered, `${declared.type} is advertised but not in the registry`).toBeDefined();
      const enforced = resolveResourceType(declared.type);
      expect(declared.effectClass).toBe(enforced.effectClass);
      expect(declared.humanAttestation).toBe(enforced.humanAttestation);
    }
  });
});

describe("published profile — the JSON block IS the served document (#5541)", () => {
  it("carries exactly the top-level keys buildPactProfile() emits", () => {
    // The document's claim: "any top-level key the builder gains that this
    // block does not carry fails that suite". Before this test, four of the
    // eleven keys were unmodelled and therefore uncompared, which is how
    // atomicOnboard / manifest / mandates / parleys went missing unnoticed
    // (§ What changed, the sessionAwareness row).
    expect(Object.keys(profile).sort()).toEqual(Object.keys(generatedProfile).sort());
  });

  it("states its one departure, so it cannot be quietly widened", () => {
    expect(profileMarkdown).toContain("one departure and no others");
    expect(profileMarkdown).toContain("`declaredGaps[].statement` is abridged away");
  });

  it("departure 1 is retired: the block's version and level ARE the served values (#5539)", () => {
    // #5541 deliberately held the block at v1.1 behind a STALE marker while
    // the version claim had no evidence; #5539 re-derived both claims from
    // the wire the KG now serves. The divergence AND the marker must stay
    // gone together — the retired departure-1 test allowed the pair back in,
    // which is exactly the drift this replacement forbids.
    expect(profile.specVersion).toBe(generatedProfile.specVersion);
    expect(profile.conformanceLevel).toBe(generatedProfile.conformanceLevel);
    expect(profileMarkdown).not.toContain("STALE, see [#5539]");
  });

  it("departure 2: gap areas in served order, tracking as served, no statement at all", () => {
    expect(profile.declaredGaps.map((g) => g.area)).toEqual(
      generatedProfile.declaredGaps.map((g) => g.area)
    );
    expect(profile.declaredGaps.map((g) => g.tracking ?? null)).toEqual(
      generatedProfile.declaredGaps.map((g) => g.tracking ?? null)
    );
    // An abridged entry can never become a WRONG one, because it may not carry
    // the field that could be wrong.
    expect(profile.declaredGaps.filter((g) => "statement" in g).map((g) => g.area)).toEqual([]);
  });

  it("every other key, at every depth, equals buildPactProfile() value-for-value", () => {
    const documentAsJson = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
    expect(jsonDiff(documentAsJson, servedAsDocumentMayRenderIt())).toEqual([]);
  });

  it("declares every well-known capability flag the builder emits, with its value", () => {
    expect(profile.capabilities).toEqual(generatedProfile.capabilities);
    expect(Object.keys(profile.capabilities).sort()).toEqual(
      Object.keys(generatedProfile.capabilities).sort()
    );
  });

  it("no attestation_chain handling exists in the KG tree, so the row's disclaimer stays true", () => {
    // PACT_CONFORMANCE.md's authorizationProof row names Tailor's separate C#
    // guard (#5583) and disclaims it as a DIFFERENT implementation. An earlier
    // revision attributed it to the KG. This is the grep that stops it coming
    // back — the same shape as effect-class.test.ts's execution-label sweep.
    const offenders = allSourceFiles()
      .filter((f) => path.basename(f) !== THIS_FILE)
      .filter((f) => fs.readFileSync(f, "utf8").includes("attestation_chain"))
      .map((f) => path.relative(SOURCE_ROOT, f));
    expect(offenders).toEqual([]);
    expect(profileMarkdown).toContain("the KG's own tree contains no such handling");
  });

  it("describes envelope.ts as it is since #5535 — a real field whose value is absent", () => {
    const envelope = fs.readFileSync(
      path.join(SOURCE_ROOT, "src", "lib", "types", "envelope.ts"),
      "utf8"
    );
    expect(envelope).toContain("attestation_ref: AttestationRef | null;");
    expect(profileMarkdown).toContain("types `attestation_ref` as `AttestationRef | null`");
    // The pre-#5535 shape the audit removed: a field whose TYPE is null.
    expect(profileMarkdown).not.toContain("types `attestation_ref` as `null`");
  });

  it("every check in this section can actually fail", () => {
    const served = servedAsDocumentMayRenderIt();
    const clone = () => JSON.parse(JSON.stringify(served)) as Record<string, unknown>;

    // A changed scalar at depth — the `"hashAlg": "md5"` edit that used to pass.
    const tampered = clone();
    (tampered.provenance as Record<string, unknown>).hashAlg = "md5";
    expect(jsonDiff(tampered, served)).not.toEqual([]);

    // A top-level key the builder has and the block does not.
    const shrunk = clone();
    delete shrunk.provenance;
    expect(jsonDiff(shrunk, served)).not.toEqual([]);

    // A gap that grows a statement back.
    const wordy = clone();
    (wordy.declaredGaps as DeclaredGapJson[])[0].statement = "…";
    expect(jsonDiff(wordy, served)).not.toEqual([]);

    // Gaps out of served order.
    const shuffled = clone();
    (shuffled.declaredGaps as DeclaredGapJson[]).reverse();
    expect(jsonDiff(shuffled, served)).not.toEqual([]);

    // An epistemics threshold moved under the extension key.
    const loosened = clone();
    const ext = (loosened.extensions as Record<string, unknown>)[EPISTEMICS_EXTENSION] as Record<
      string,
      unknown
    >;
    ext.consensusRatio = 0.5;
    expect(jsonDiff(loosened, served)).not.toEqual([]);

    // …and the identity comparison must NOT fire.
    expect(jsonDiff(served, served)).toEqual([]);
  });
});

describe("published profile — the API table IS the route tree (#5541)", () => {
  it("discovers a non-trivial route set (the audit counted ~20; the tree has more)", () => {
    expect(pactRoutes.length).toBeGreaterThanOrEqual(28);
  });

  it("names every served route — a new route with no table row fails", () => {
    const missing = pactPaths.filter((p) => !documentedRoutes.some((d) => d.path === p));
    expect(missing).toEqual([]);
  });

  it("names no route the tree does not serve — a deleted route's stale row fails", () => {
    // The direction the substring check could not see at all. A delete+add pair
    // defeated the >= 28 count floor and left the dead row standing.
    const stale = documentedRoutes
      .map((d) => d.path)
      .filter((p) => !pactPaths.includes(p));
    expect(stale).toEqual([]);
  });

  it("publishes each route's methods exactly as its module exports them", () => {
    const wrong = pactRoutes
      .map((route) => ({
        path: route.path,
        served: [...route.methods].sort(),
        documented: [...(documentedRoutes.find((d) => d.path === route.path)?.methods ?? [])].sort(),
      }))
      .filter((r) => r.served.join(",") !== r.documented.join(","));
    expect(wrong).toEqual([]);
  });

  it("lists each route exactly once", () => {
    const seen = documentedRoutes.map((d) => d.path);
    expect(seen.filter((p, i) => seen.indexOf(p) !== i)).toEqual([]);
  });

  it("the rejection path is documented — it was the headline of #5426 and went unlisted", () => {
    expect(pactPaths).toContain("/api/pact/{topicId}/proposals/{proposalId}/reject");
    expect(documentedRoutes.map((d) => d.path)).toContain(
      "/api/pact/{topicId}/proposals/{proposalId}/reject"
    );
  });

  it("every check in this section can actually fail", () => {
    const header = `${API_TABLE_HEADER}\n|---|---|---|\n`;

    expect(parseApiTable(`${header}| \`GET\` | \`/api/pact/wallet\` | x |\n`)).toEqual([
      { path: "/api/pact/wallet", methods: ["GET"] },
    ]);

    // A method set the module does not export is VISIBLE, not swallowed.
    expect(
      parseApiTable(`${header}| \`GET\`, \`POST\` | \`/api/pact/wallet\` | x |\n`)[0].methods
    ).toEqual(["GET", "POST"]);

    // Prefix shadowing no longer satisfies a row — comparison is exact-path.
    expect(
      parseApiTable(`${header}| \`GET\` | \`/api/pact/topics\` | x |\n`).some(
        (r) => r.path === "/api/pact/topics/{topicId}"
      )
    ).toBe(false);

    // A mention outside a table is not a row: `endpoints.poll` in the JSON
    // block used to satisfy the events route all by itself.
    expect(parseApiTable("`/api/pact/{topicId}/events` in prose, not a table")).toEqual([]);

    // The extractor reads BOTH export shapes the tree actually uses.
    expect(
      routeMethods(path.join(PACT_ROUTES_DIR, "[topicId]", "dependencies", "route.ts"))
    ).toEqual(["GET", "POST", "DELETE"]);
    expect(routeMethods(path.join(PACT_ROUTES_DIR, "topics", "[topicId]", "route.ts"))).toEqual([
      "GET",
    ]);

    // …and the real document parses to one row per served route.
    expect(parseApiTable(profileMarkdown)).toHaveLength(pactRoutes.length);
  });
});

describe("published profile — consensus thresholds are re-derived, not restated (#5541)", () => {
  const dbSource = fs.readFileSync(path.join(SOURCE_ROOT, "src", "lib", "db.ts"), "utf8");

  function constFromDb(name: string): string {
    const m = dbSource.match(new RegExp(`const ${name} = ([^;]+);`));
    if (!m) throw new Error(`db.ts no longer defines ${name}`);
    return m[1].trim();
  }

  it("the published alignment ratio equals CONSENSUS_RATIO", () => {
    expect(constFromDb("CONSENSUS_RATIO")).toBe("0.90");
    expect(profileMarkdown).toContain(">= 0.90` (`CONSENSUS_RATIO`)");
  });

  it("the published stabilisation window equals STABLE_DAYS", () => {
    expect(constFromDb("STABLE_DAYS")).toBe("30");
    expect(profileMarkdown).toContain("`STABLE_DAYS = 30`");
  });

  it("the published convention-stop quorum equals CONVENTION_STOP_BASE_AGENTS", () => {
    expect(dbSource).toContain("export const CONVENTION_STOP_BASE_AGENTS = 2;");
    expect(profileMarkdown).toContain("`CONVENTION_STOP_BASE_AGENTS = 2`");
  });

  it("every tier's participation floor is published with the value db.ts enforces", () => {
    const block = dbSource.match(/export const TIER_BASE_AGENTS: Record<string, number> = \{([\s\S]*?)\};/);
    expect(block).not.toBeNull();
    const tiers = [...block![1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => ({ tier: m[1], floor: Number(m[2]) }));
    expect(tiers.length).toBeGreaterThan(0);
    for (const { tier, floor } of tiers) {
      // The tier must be named in the profile, in a table row that also
      // carries its floor.
      const row = profileMarkdown
        .split("\n")
        .find((line) => line.includes("|") && line.includes(`\`${tier}\``) && /\|\s*\d+\s*\|/.test(line));
      expect(row, `tier ${tier} (floor ${floor}) is not published with its floor`).toBeDefined();
      expect(row).toMatch(new RegExp(`\\|\\s*${floor}\\s*\\|`));
    }
  });

  it("the dependency gate is published as a promotion gate, not as an April 2026 vote threshold", () => {
    expect(profileMarkdown).toContain("dependencyGateOk");
    expect(profileMarkdown).toContain("unmetDependencies == 0");
    // The stale claims the audit named must be gone.
    expect(profileMarkdown).not.toContain("3+ agents must vote to open debate");
    expect(profileMarkdown).not.toContain("90%+ agents align");
  });

  it("the published verified set equals VERIFIED_TOPIC_STATUSES", () => {
    for (const status of VERIFIED_TOPIC_STATUSES) {
      expect(profileMarkdown).toContain(`\`${status}\``);
    }
  });

  it("the published independence-class rules equal INDEPENDENCE_CONFIG", () => {
    expect(profileMarkdown).toContain(`| ${INDEPENDENCE_CONFIG.minAccountAgeDays} days |`);
    expect(profileMarkdown).toContain(`| ${INDEPENDENCE_CONFIG.minAcceptedContributions} |`);
    expect(profileMarkdown).toContain(`\`${INDEPENDENCE_CONFIG.grandfatherCutoff}\``);
    expect(profileMarkdown).toContain("`false` — the proposer's own class is excluded");
    expect(INDEPENDENCE_CONFIG.allowSelfApproval).toBe(false);
  });
});

describe("published profile — live discovery and remaining gaps (#5541)", () => {
  it("documents the generated discovery route without inventing a static copy", () => {
    const routePath = path.join(
      SOURCE_ROOT,
      "src",
      "app",
      ".well-known",
      "pact.json",
      "route.ts"
    );
    const staticPath = path.join(SOURCE_ROOT, "public", ".well-known", "pact.json");
    const routeSource = fs.readFileSync(routePath, "utf8");
    const epistemics = generatedProfile.extensions[EPISTEMICS_EXTENSION] as {
      consensusRatio: number;
    };

    expect(fs.existsSync(routePath)).toBe(true);
    expect(fs.existsSync(staticPath)).toBe(false);
    expect(routeSource).toContain(
      'import { CONFORMANCE_RESULTS_PATH, PUBLIC_BASE_URL, buildPactProfile } from "@/lib/pact-profile"'
    );
    expect(routeSource).toContain(
      "JSON.stringify(buildPactProfile(PUBLIC_BASE_URL, { conformanceReportShipped: CONFORMANCE_REPORT_SHIPPED })"
    );
    expect(generatedProfile.endpoints.wellKnown).toBe(
      `${PUBLIC_BASE_URL}/.well-known/pact.json`
    );
    expect(epistemics.consensusRatio).toBe(CONSENSUS_RATIO);

    expect(generatedProfile.capabilities.inviteTokens).toBe(true);
    expect(pactPaths).toContain("/api/pact/{topicId}/join-token");
    expect(generatedProfile.capabilities.structuredNegotiation).toBe(true);
    for (const primitive of ["intents", "constraints", "salience", "dependencies", "assumptions"]) {
      expect(pactPaths).toContain(`/api/pact/{topicId}/${primitive}`);
    }

    expect(profileMarkdown).toContain("is live, generated, and never static");
    expect(profileMarkdown).toContain("`buildPactProfile()`");
    expect(profileMarkdown).toContain("bounded claim");
    expect(profileMarkdown).not.toContain("No `/.well-known/pact.json`");
  });

  it("distinguishes observed retention from a written policy and names the unsupported endpoint", () => {
    expect(profileMarkdown).toContain("The KG still has no written retention policy of any kind");
    expect(profileMarkdown).toContain("No `credentialsRegistry` endpoint");
  });

  it("states the §6.4 chained epoch without inventing a legacy backfill", () => {
    const provenanceSource = fs.readFileSync(
      path.join(SOURCE_ROOT, "src", "lib", "provenance-chain.ts"),
      "utf8"
    );

    expect(provenanceSource).toContain("export async function appendChainedEvent");
    expect(provenanceSource).toContain("export function verifyOrderedChain");
    expect(provenanceSource).toContain('export const GENESIS_UNCHAINED = "GENESIS-UNCHAINED"');

    // #5599 (via #5539): "is transactional" overstated the append — it is
    // atomic within itself, but on every production route it commits in a
    // transaction SEPARATE from the state change it records. The document
    // must carry the shortfall, never the overstatement.
    expect(profileMarkdown).not.toContain("`emitEvent` append is transactional");
    expect(profileMarkdown).toContain("a transaction of its own");
    expect(profileMarkdown).toContain("gapless per-resource `sequenceNumber`");
    expect(profileMarkdown).toContain("`prev_hash`");
    expect(profileMarkdown).toContain("structured first-break report");
    expect(profileMarkdown).toContain("`GENESIS-UNCHAINED`");
    expect(profileMarkdown).toContain("`unchainedPriorEvents`");
    expect(profileMarkdown).toContain("not a full-history claim");
    expect(profileMarkdown).not.toContain("No §6.4 event-log integrity");
    expect(profileMarkdown).not.toContain("no gapless `sequenceNumber`");
  });

  it("names the trackers for the §6.4 shortfalls as open work, not the closed #5598", () => {
    // #5539: the wire's `tracking` was repointed off the CLOSED #5598 onto
    // #5599 (separate-transaction chain link) + #5650 (signed root, anchor,
    // cross-impl comparison), and the document reproduces `tracking` exactly
    // as served (departure rules above). The prose here must name the same
    // open trackers so a reader of either rendering lands on live work.
    expect(profileMarkdown).toContain("issues/5599");
    expect(profileMarkdown).toContain("issues/5650");
  });
});

/**
 * THE CONFORMANCE RESULTS DOCUMENT (#5567).
 *
 * The block above is the SHIPPED rendering, so it advertises
 * `endpoints.conformanceResults`; an origin whose deploy did not ship the
 * document must NOT advertise it (the #5539 never-a-404 rule). The document
 * itself is CI-produced per run — never committed — so this section holds
 * the seams that keep it that way: the path is untracked in git and
 * gitignored, the route decides shipped-ness from the file's presence, and
 * the producing / validating / verifying steps exist where the profile
 * says they do.
 */
describe("published profile — the conformance results document (#5567)", () => {
  const REPO_ROOT = SOURCE_ROOT; // the app is the repo root since the #5949 rehome
  const RESULTS_REL = "public/.well-known/pact-conformance-v23.json";

  it("the block IS the shipped rendering: endpoints.conformanceResults equals the shipped builder output", () => {
    expect(profile.endpoints.conformanceResults).toBe(generatedProfile.endpoints.conformanceResults);
    expect(profile.endpoints.conformanceResults).toBe(`${PUBLIC_BASE_URL}${CONFORMANCE_RESULTS_PATH}`);
    expect(CONFORMANCE_RESULTS_PATH).toBe(`/${RESULTS_REL.replace(/^public\//, "")}`);
  });

  it("an origin that did not ship the document does not advertise it — never a 404 (#5539)", () => {
    const unshipped = buildPactProfile();
    expect(Object.keys(unshipped.endpoints)).not.toContain("conformanceResults");
    expect(Object.keys(buildPactProfile(PUBLIC_BASE_URL, { conformanceReportShipped: false }).endpoints)).not.toContain(
      "conformanceResults"
    );
    // ...and that is the ONLY difference between the two renderings.
    const shippedMinusKey = JSON.parse(JSON.stringify(generatedProfile)) as { endpoints: Record<string, string> };
    delete shippedMinusKey.endpoints.conformanceResults;
    expect(jsonDiff(JSON.parse(JSON.stringify(unshipped)), shippedMinusKey)).toEqual([]);
  });

  it("the route answers shipped-ness from the file's presence, once, and tells the builder", () => {
    const routeSource = fs.readFileSync(
      path.join(SOURCE_ROOT, "src", "app", ".well-known", "pact.json", "route.ts"),
      "utf8"
    );
    expect(routeSource).toContain("fs.existsSync(");
    expect(routeSource).toContain("CONFORMANCE_RESULTS_PATH");
    expect(routeSource).toContain("conformanceReportShipped: CONFORMANCE_REPORT_SHIPPED");
  });

  it("no results document is tracked in git — and .gitignore says so", () => {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", RESULTS_REL], {
      cwd: SOURCE_ROOT,
      encoding: "utf8",
    });
    // git must have RUN (a missing binary would be a vacuous pass) and must
    // have refused the path (exit 1 = not tracked).
    expect(tracked.error).toBeUndefined();
    expect(tracked.status).not.toBe(0);
    const gitignore = fs.readFileSync(path.join(SOURCE_ROOT, ".gitignore"), "utf8");
    expect(gitignore.split(/\r?\n/)).toContain(`/${RESULTS_REL}`);
  });

  it("is produced by cd-kg.yml's kg-conformance job, validated before the image build, verified after the deploy", () => {
    // Line-ending agnostic: a Windows autocrlf checkout materialises CRLF.
    const cdSource = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "cd-kg.yml"), "utf8").replace(/\r\n/g, "\n");
    expect(cdSource).toContain("\n  kg-conformance:\n");
    expect(cdSource).toContain("PACT_CONFORMANCE_RESULTS_PATH:");
    expect(cdSource).toContain("src/lib/execution-boundary-vectors.itest.ts");
    expect(cdSource).toContain(`name: ${RESULTS_ARTIFACT_NAME}`);
    expect(cdSource).toContain("needs: [kg-conformance]");
    expect(cdSource).toContain("if: ${{ !cancelled() }}");
    expect(cdSource).toContain(`git ls-files --error-unmatch ${RESULTS_REL}`);
    expect(cdSource).toContain(`cp "$REPORT" ${RESULTS_REL}`);
    expect(cdSource).toContain("Verify the served conformance results are this run's");
    const prCheck = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "pr-check.yml"), "utf8");
    expect(prCheck).toContain(`git ls-files --error-unmatch ${RESULTS_REL}`);
  });

  it("next.config.ts serves the document with the discovery document's cache + CORS posture", () => {
    const nextConfig = fs.readFileSync(path.join(SOURCE_ROOT, "next.config.ts"), "utf8");
    expect(nextConfig).toContain(`source: "${CONFORMANCE_RESULTS_PATH}"`);
    expect(nextConfig).toContain('{ key: "Cache-Control", value: "public, max-age=300, s-maxage=300" }');
    expect(nextConfig).toContain('{ key: "Access-Control-Allow-Origin", value: "*" }');
  });

  it("the document names the producing job, the status rule, and the accounting the committed manifests imply", () => {
    expect(profileMarkdown).toContain("## Conformance results (CI-produced, #5567)");
    expect(profileMarkdown).toContain("`kg-conformance`");
    expect(profileMarkdown).toContain("cosign verify");
    // The headline counts are RECOMPUTED from the manifests the builder reads
    // — pass = every executed id on a green run, skip / excluded = what the
    // acceptance + dispositions manifests dispose, corpus = the fixture's
    // expected_vector_ids — never typed here, so a fixture change forces the
    // doc edit (the tailor-app side's fixture-implied pin, mirrored).
    const fixtureDir = path.join(SRC_DIR, "lib", "fixtures", "pact-v23");
    const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")) as T;
    const fixture = read<CorpusFixture>("execution-boundary-vectors.json");
    const acceptance = read<AcceptanceManifest>("execution-boundary-acceptance.json");
    const dispositioned = flattenDispositions(read<DispositionsManifest>("conformance-dispositions.json"));
    const corpus = fixture.expected_vector_ids.length;
    const pass = acceptance.executed.length;
    const skip = dispositioned.filter((entry) => entry.status === "skip").length;
    const excluded =
      acceptance.capability_excluded.length + dispositioned.filter((entry) => entry.status === "excluded").length;
    expect(pass + skip + excluded).toBe(corpus);
    expect(profileMarkdown).toContain(`pass ${pass} / fail 0 / skip ${skip} / excluded ${excluded} over the ${corpus}-id`);
    expect(profileMarkdown).toContain(`${excluded} of ${corpus} ids are not`);
  });
});

/**
 * THE HEADER IS THE WIRE (#5539).
 *
 * The audit behind #5539 found three spec versions declared across two
 * implementations and one vector set (v1.1 / v2.0.2 / v2.3); this file's
 * header carried the v1.1 half of that split for nearly five months. The
 * value is now re-derived from `buildPactProfile()` — the same builder that
 * serves `/.well-known/pact.json` — and this section pins the two header
 * lines to it, so the header can never again state a version or level the
 * wire does not serve. Bump `SPEC_VERSION` (or move `CONFORMANCE_LEVEL`)
 * without editing the header and this fails; edit the header without the
 * wire moving and this fails; re-attach a STALE marker (or any other prose)
 * to either line and the exact-remainder comparison fails.
 */
describe("published profile — the header states the served version and level (#5539)", () => {
  it("the Spec Version line IS the served specVersion — nothing more, no marker", () => {
    expect(headerLine(profileMarkdown, "PACT Spec Version")).toBe(
      `v${generatedProfile.specVersion}`
    );
  });

  it("the Conformance Level line IS the served conformanceLevel — nothing more, no marker", () => {
    expect(headerLine(profileMarkdown, "Conformance Level")?.toLowerCase()).toBe(
      generatedProfile.conformanceLevel
    );
  });

  it("every check in this section can actually fail", () => {
    const good = "> **PACT Spec Version:** v2.3\n> **Conformance Level:** Core\n";
    expect(headerLine(good, "PACT Spec Version")).toBe("v2.3");
    expect(headerLine(good, "Conformance Level")).toBe("Core");

    // The exact shape #5541 left: a stale marker riding the line. The
    // remainder comparison sees the whole tail, so the marker is visible.
    const stale =
      "> **PACT Spec Version:** v1.1 — **STALE, see [#5539](https://github.com/TailorAU/tailor-app/issues/5539)**\n";
    expect(headerLine(stale, "PACT Spec Version")).not.toBe(
      `v${generatedProfile.specVersion}`
    );

    // A wrong-but-tidy value is caught, not just a decorated one.
    expect(headerLine("> **PACT Spec Version:** v9.9\n", "PACT Spec Version")).not.toBe(
      `v${generatedProfile.specVersion}`
    );

    // A deleted or renamed header line is null — never a vacuous pass.
    expect(headerLine("no header here", "PACT Spec Version")).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// #5598 interlock, merged in from main: the document may not contradict the
// wire on §6.3 retention. Kept as it landed on main so the two renderings of
// one claim cannot drift apart again.
// ---------------------------------------------------------------------------


/**
 * THE DOCUMENT/WIRE INTERLOCK for §6.3 retention (#5598).
 *
 * `PACT_CONFORMANCE.md` is the human-readable conformance profile; the
 * `/.well-known/pact.json` document built by `buildPactProfile()` is the
 * machine-readable one. They are two renderings of one claim, and #5541 found
 * the failure mode that follows from having two: the Markdown drifted, nobody
 * noticed, and a reader who trusted it was misinformed by a file that looked
 * maintained.
 *
 * #5598 is that same failure one layer down — the served `retentionPolicy`
 * said `{ minimumDays: 0, indefinite: true }` while a daily job hard-deleted
 * event rows. The fix derives the wire from the enforcing constants
 * (`pact-profile.test.ts` guards that derivation). This file closes the
 * remaining hole: prose in the Markdown that contradicts the wire.
 *
 * ## Why this lives here and not in the document
 *
 * `PACT_CONFORMANCE.md` is owned by PR #5578 (#5541) and is deliberately NOT
 * edited by #5598. Putting the check in a test rather than in the prose makes
 * the contradiction UNMERGEABLE rather than merely noticed: #5578 may say
 * whatever it likes about retention, provided what it says is what the server
 * serves.
 *
 * **This is expected to turn PR #5578 red until its retention prose is
 * updated. That is the intended effect, and it was signed off as such.** The
 * document as it stands (v1.1, April 2026) states nothing about retention at
 * all, so this suite is green today; it bites the moment a number appears.
 *
 * ## Tolerant in shape, strict in substance
 *
 * The Markdown is prose. A test demanding an exact sentence would repeat the
 * mistake of pinning the stale §6.4 gap text — green until someone rewords
 * it, then red for no reason. So the extraction below is deliberately narrow:
 * it looks only at statements that are BOTH about the event log AND about
 * retention, and it only ever compares numbers. The cleanup route's other
 * schedules (90-day proposals, 90-day registrations) are not described by
 * `retentionPolicy` and are explicitly not the subject here.
 *
 * ## Every check is proven able to fail
 *
 * The extraction is a pure function over a string, so the last test in this
 * file runs it against known-BAD fixtures and asserts each one throws, plus a
 * known-GOOD fixture that must not. That is what stops this suite becoming
 * the guard it was written to replace — one that passed because it never
 * actually looked at anything.
 */

const CONFORMANCE_DOC = path.join(SOURCE_ROOT, "PACT_CONFORMANCE.md");

const served = buildPactProfile().retentionPolicy;

/** Statements about the EVENT LOG — not proposals, tokens or registrations. */
const ABOUT_EVENTS = /\bevents?\b|\bevent log\b/i;

/** Statements about RETENTION — not about events generally. */
const ABOUT_RETENTION = /\bretain|\bretention|\bpurg|\bdelet|\btombston|\bexpir/i;

/** A day figure: `30 days`, `30-day`, `30day`. */
const DAY_FIGURE = /(\d+)[\s-]?days?\b/gi;

/**
 * Sentences that DENY an event-log deletion path. Each is a literal shape the
 * false claim actually took, or the obvious rewording of it — narrow on
 * purpose, because "chained rows are retained indefinitely" is a TRUE
 * sentence about half the log and must not trip anything.
 */
const PURGE_DENIALS: readonly RegExp[] = [
  /holds no (?:purge|expiry|tombstone)/i,
  /no (?:purge|expiry|delete|deletion|tombstone) (?:path|mechanism)/i,
  /events? (?:are|is) never (?:deleted|purged|removed|expired)/i,
  /event log is (?:retained|kept) (?:forever|indefinitely)/i,
  /nothing (?:deletes|purges|removes) events/i,
];

/** What the Markdown STATES about event retention, extracted structurally. */
interface StatedRetention {
  /** Every `"retentionPolicy": { … }` object the document declares. */
  readonly declaredPolicies: Record<string, unknown>[];
  /** Day figures, grouped by the statement that carried them. */
  readonly statedDayFigures: number[][];
  /** Statements denying that any event-log deletion path exists. */
  readonly purgeDenials: string[];
}

/**
 * Pure extractor — no assertions, no filesystem. Split out so the fixtures at
 * the bottom of this file can prove each check bites.
 *
 * `retentionPolicy` is a flat object of scalars, so a non-nested `{…}` match
 * is sufficient and avoids hand-rolling a brace matcher over prose.
 */
function readStatedRetention(markdown: string): StatedRetention {
  const declaredPolicies: Record<string, unknown>[] = [];
  for (const match of markdown.matchAll(/"retentionPolicy"\s*:\s*\{[^{}]*\}/g)) {
    const parsed = JSON.parse(`{${match[0]}}`) as { retentionPolicy: Record<string, unknown> };
    declaredPolicies.push(parsed.retentionPolicy);
  }

  const statedDayFigures: number[][] = [];
  const purgeDenials: string[] = [];
  // Sentence-ish granularity, not line granularity: a Markdown paragraph is
  // one line, and a paragraph may legitimately mention the 90-day proposal
  // schedule in a different sentence from the event-log bound.
  for (const statement of markdown.split(/(?<=[.!?])\s+|\n/)) {
    if (!ABOUT_EVENTS.test(statement)) continue;
    if (!ABOUT_RETENTION.test(statement)) continue;
    const figures = [...statement.matchAll(DAY_FIGURE)].map((m) => Number(m[1]));
    if (figures.length > 0) statedDayFigures.push(figures);
    if (PURGE_DENIALS.some((pattern) => pattern.test(statement))) purgeDenials.push(statement);
  }

  return { declaredPolicies, statedDayFigures, purgeDenials };
}

/** Asserts the extracted claims against the served policy. Throws on mismatch. */
function assertStatedRetentionMatches(stated: StatedRetention, policy: RetentionPolicy): void {
  const wire = policy as unknown as Record<string, unknown>;

  // 1. A declared machine-readable block must BE the served block, key for
  // key. Per-key rather than deep-equal, so an abbreviated excerpt may omit a
  // field — but never state a different value for one.
  for (const declared of stated.declaredPolicies) {
    for (const [key, value] of Object.entries(declared)) {
      expect(Object.keys(wire)).toContain(key);
      expect(value).toEqual(wire[key]);
    }
  }

  // 2. Any statement giving a day bound for the event log must include the
  // bound actually enforced. Other figures may sit in the same sentence (the
  // cleanup route's 90-day schedules are legitimately mentioned in scope
  // notes); a sentence that gives a bound and omits the real one is stating a
  // retention period this server does not honour.
  for (const figures of stated.statedDayFigures) {
    expect(figures).toContain(policy.minimumDays);
  }

  // 3. While a hard-delete path is live, the document may not deny one.
  if (UNCHAINED_EVENTS_PURGED) {
    expect(stated.purgeDenials).toEqual([]);
  }
}

describe("PACT_CONFORMANCE.md — the document may not contradict the wire (§6.3)", () => {
  it("the document is where the interlock expects it", () => {
    // If #5578 moves or renames this file, red is the correct outcome: the
    // interlock has lost its subject and must be re-pointed deliberately.
    expect(fs.existsSync(CONFORMANCE_DOC)).toBe(true);
  });

  it("states no retention number that differs from the served retentionPolicy", () => {
    const markdown = fs.readFileSync(CONFORMANCE_DOC, "utf8");
    assertStatedRetentionMatches(readStatedRetention(markdown), served);
  });

  it("the served policy this is measured against is the enforcing constant", () => {
    // Guards the interlock's own reference point. Compared against a literal
    // typed here, the two files could agree with each other and both be wrong
    // about the code.
    expect(served.minimumDays).toBe(UNCHAINED_EVENT_RETENTION_DAYS);
    expect(served.indefinite).toBe(!UNCHAINED_EVENTS_PURGED);
  });

  it("every check in this file can actually fail", () => {
    // Fixture figures are DERIVED from the served policy, never typed. A
    // literal `0` here would quietly stop being a contradiction on the day
    // someone set the real bound to 0 — which is the exact class of dead
    // guard this whole change exists to remove.
    const wrongDays = served.minimumDays + 60;

    // A contradicting machine-readable block — the shape that was served,
    // falsely, before #5598.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(
          '```json\n{ "retentionPolicy": ' +
            `{ "minimumDays": ${wrongDays}, "indefinite": ${!served.indefinite} }` +
            " }\n```"
        ),
        served
      )
    ).toThrow();

    // A contradicting prose bound.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(`Events are purged ${wrongDays} days after creation.`),
        served
      )
    ).toThrow();

    // A denial of the purge path — the §6.3 gap's own pre-#5598 wording.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(
          "The implementation holds no purge, expiry or tombstone path for the event log."
        ),
        served
      )
    ).toThrow();

    // ...and the shapes that must NOT trip it: the true half of the split,
    // and a schedule `retentionPolicy` does not describe.
    expect(() =>
      assertStatedRetentionMatches(
        readStatedRetention(
          "Chained event rows are retained indefinitely. " +
            `Unchained event rows are hard-deleted ${served.minimumDays} days after ` +
            "creation. " +
            `Resolved proposals are deleted after ${wrongDays} days.`
        ),
        served
      )
    ).not.toThrow();
  });
});
