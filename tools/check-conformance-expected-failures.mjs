#!/usr/bin/env node

/**
 * Enforce an exact vector inventory and expected-failure set for a
 * conformance-runner JSON report.
 *
 * Usage:
 *   node tools/check-conformance-expected-failures.mjs <report.json> <manifest.json>
 *
 * The check fails on an added/missing vector, unexpected failure, expected
 * failure that passes (XPASS), skipped vector, duplicate ID, or malformed input.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const STATUSES = new Set(['pass', 'fail', 'skip']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function formatList(label, values) {
  return `${label}:\n${values.map((value) => `  - ${value}`).join('\n')}`;
}

function assertManifestShape(manifest) {
  if (!isRecord(manifest)) {
    throw new Error('Malformed manifest: top level must be a JSON object.');
  }
  if (typeof manifest.tracking_issue !== 'string' || manifest.tracking_issue.trim() === '') {
    throw new Error('Malformed manifest: `tracking_issue` must be a non-empty string.');
  }
  if (!Array.isArray(manifest.expected_vector_ids) || manifest.expected_vector_ids.length === 0) {
    throw new Error('Malformed manifest: `expected_vector_ids` must be a non-empty array.');
  }
  for (const [index, id] of manifest.expected_vector_ids.entries()) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(`Malformed manifest: expected_vector_ids[${index}] must be a non-empty string.`);
    }
  }
  const vectorDuplicates = duplicateValues(manifest.expected_vector_ids);
  if (vectorDuplicates.length > 0) {
    throw new Error(formatList('Malformed manifest: duplicate expected-vector IDs', vectorDuplicates));
  }
  if (!Array.isArray(manifest.expected_failures)) {
    throw new Error('Malformed manifest: `expected_failures` must be an array.');
  }
  for (const [index, id] of manifest.expected_failures.entries()) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(`Malformed manifest: expected_failures[${index}] must be a non-empty string.`);
    }
  }
  const duplicates = duplicateValues(manifest.expected_failures);
  if (duplicates.length > 0) {
    throw new Error(formatList('Malformed manifest: duplicate expected-failure IDs', duplicates));
  }
  const inventory = new Set(manifest.expected_vector_ids);
  const failuresOutsideInventory = manifest.expected_failures
    .filter((id) => !inventory.has(id))
    .sort();
  if (failuresOutsideInventory.length > 0) {
    throw new Error(
      formatList('Malformed manifest: expected-failure IDs absent from vector inventory', failuresOutsideInventory),
    );
  }
}

function assertReportShape(report) {
  if (!isRecord(report)) {
    throw new Error('Malformed report: top level must be a JSON object.');
  }
  if (!Array.isArray(report.results)) {
    throw new Error('Malformed report: `results` must be an array.');
  }

  const ids = [];
  const calculatedCounts = { pass: 0, fail: 0, skip: 0 };
  for (const [index, result] of report.results.entries()) {
    if (!isRecord(result)) {
      throw new Error(`Malformed report: results[${index}] must be an object.`);
    }
    if (typeof result.id !== 'string' || result.id.trim() === '') {
      throw new Error(`Malformed report: results[${index}].id must be a non-empty string.`);
    }
    if (!isRecord(result.outcome) || !STATUSES.has(result.outcome.status)) {
      throw new Error(
        `Malformed report: results[${index}].outcome.status must be one of pass, fail, skip.`,
      );
    }
    ids.push(result.id);
    calculatedCounts[result.outcome.status] += 1;
  }

  const duplicates = duplicateValues(ids);
  if (duplicates.length > 0) {
    throw new Error(formatList('Malformed report: duplicate vector IDs', duplicates));
  }

  if (!isRecord(report.counts)) {
    throw new Error('Malformed report: `counts` must be an object.');
  }
  for (const status of STATUSES) {
    const count = report.counts[status];
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Malformed report: counts.${status} must be a non-negative integer.`);
    }
    if (count !== calculatedCounts[status]) {
      throw new Error(
        `Malformed report: counts.${status}=${count} does not match ${calculatedCounts[status]} result(s).`,
      );
    }
  }
}

/**
 * Validate and compare a parsed runner report and expected-failure manifest.
 * Returns a compact summary on success and throws on any gate violation.
 */
export function checkConformanceExpectedFailures(report, manifest) {
  assertReportShape(report);
  assertManifestShape(manifest);

  const byId = new Map(report.results.map((result) => [result.id, result.outcome.status]));
  const expectedInventory = new Set(manifest.expected_vector_ids);
  const expected = new Set(manifest.expected_failures);

  const unexpectedVectorIds = report.results
    .filter((result) => !expectedInventory.has(result.id))
    .map((result) => result.id)
    .sort();
  const missingVectorIds = manifest.expected_vector_ids
    .filter((id) => !byId.has(id))
    .sort();

  const unexpectedFailures = report.results
    .filter((result) => result.outcome.status === 'fail' && !expected.has(result.id))
    .map((result) => result.id)
    .sort();
  const unexpectedPasses = manifest.expected_failures
    .filter((id) => byId.get(id) === 'pass')
    .sort();
  const missingExpected = manifest.expected_failures
    .filter((id) => !byId.has(id))
    .sort();
  const skipped = report.results
    .filter((result) => result.outcome.status === 'skip')
    .map((result) => result.id)
    .sort();

  const problems = [];
  if (unexpectedVectorIds.length > 0) {
    problems.push(formatList('Unexpected vector ID absent from manifest inventory', unexpectedVectorIds));
  }
  if (missingVectorIds.length > 0) {
    problems.push(formatList('Expected vector ID missing from report', missingVectorIds));
  }
  if (unexpectedFailures.length > 0) {
    problems.push(formatList('Unexpected FAIL', unexpectedFailures));
  }
  if (unexpectedPasses.length > 0) {
    problems.push(formatList('Unexpected PASS (XPASS)', unexpectedPasses));
  }
  if (missingExpected.length > 0) {
    problems.push(formatList('Expected-failure ID missing from report', missingExpected));
  }
  if (skipped.length > 0) {
    problems.push(formatList('Skipped vectors are not allowed', skipped));
  }

  if (problems.length > 0) {
    throw new Error(`Conformance expected-failure check failed.\n${problems.join('\n')}`);
  }

  return {
    total: report.results.length,
    pass: report.counts.pass,
    expected_fail: manifest.expected_failures.length,
    skip: report.counts.skip,
  };
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${label} ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed ${label} JSON ${path}: ${error.message}`);
  }
}

function runCli() {
  const [reportPath, manifestPath, ...extra] = process.argv.slice(2);
  if (!reportPath || !manifestPath || extra.length > 0) {
    console.error(
      'Usage: node tools/check-conformance-expected-failures.mjs <report.json> <manifest.json>',
    );
    process.exitCode = 2;
    return;
  }

  try {
    const report = readJson(reportPath, 'report');
    const manifest = readJson(manifestPath, 'manifest');
    const summary = checkConformanceExpectedFailures(report, manifest);
    console.log(
      `Expected-failure set matched exactly: ${summary.pass} pass, ` +
        `${summary.expected_fail} expected fail, ${summary.skip} skip ` +
        `(${summary.total} vectors).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  runCli();
}
