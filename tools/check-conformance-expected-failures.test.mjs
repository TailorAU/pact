import assert from 'node:assert/strict';
import test from 'node:test';

import { checkConformanceExpectedFailures } from './check-conformance-expected-failures.mjs';

const EXPECTED_ID = 'extended/execution-boundary/known-gap';
const PASS_ID = 'core/join/basic';

function result(id, status) {
  return { id, kind: 'http', outcome: { status } };
}

function report(results) {
  return {
    counts: {
      pass: results.filter((item) => item.outcome.status === 'pass').length,
      fail: results.filter((item) => item.outcome.status === 'fail').length,
      skip: results.filter((item) => item.outcome.status === 'skip').length,
    },
    results,
  };
}

function manifest(expectedFailures = [EXPECTED_ID]) {
  return {
    tracking_issue: 'https://github.com/TailorAU/pact/issues/62',
    expected_vector_ids: [PASS_ID, EXPECTED_ID],
    expected_failures: expectedFailures,
  };
}

test('accepts an exact expected-failure set', () => {
  const summary = checkConformanceExpectedFailures(
    report([result(PASS_ID, 'pass'), result(EXPECTED_ID, 'fail')]),
    manifest(),
  );
  assert.deepEqual(summary, { total: 2, pass: 1, expected_fail: 1, skip: 0 });
});

test('rejects an unexpected failure', () => {
  assert.throws(
    () =>
      checkConformanceExpectedFailures(
        report([
          result(PASS_ID, 'fail'),
          result(EXPECTED_ID, 'fail'),
        ]),
        manifest(),
      ),
    /Unexpected FAIL:[\s\S]*core\/join\/basic/,
  );
});

test('rejects an XPASS', () => {
  assert.throws(
    () => checkConformanceExpectedFailures(report([result(EXPECTED_ID, 'pass')]), manifest()),
    /Unexpected PASS \(XPASS\):[\s\S]*known-gap/,
  );
});

test('rejects any skipped vector', () => {
  assert.throws(
    () =>
      checkConformanceExpectedFailures(
        report([result(EXPECTED_ID, 'fail'), result(PASS_ID, 'skip')]),
        manifest(),
      ),
    /Skipped vectors are not allowed:[\s\S]*core\/join\/basic/,
  );
});

test('rejects a manifest ID missing from the report', () => {
  assert.throws(
    () => checkConformanceExpectedFailures(report([result(PASS_ID, 'pass')]), manifest()),
    /Expected vector ID missing from report:[\s\S]*known-gap/,
  );
});

test('rejects a missing ordinary passing vector', () => {
  assert.throws(
    () => checkConformanceExpectedFailures(report([result(EXPECTED_ID, 'fail')]), manifest()),
    /Expected vector ID missing from report:[\s\S]*core\/join\/basic/,
  );
});

test('rejects an unexpected vector ID even when it passes', () => {
  assert.throws(
    () =>
      checkConformanceExpectedFailures(
        report([
          result(PASS_ID, 'pass'),
          result(EXPECTED_ID, 'fail'),
          result('extended/new-vector', 'pass'),
        ]),
        manifest(),
      ),
    /Unexpected vector ID absent from manifest inventory:[\s\S]*extended\/new-vector/,
  );
});

test('rejects duplicate report and manifest IDs', async (t) => {
  await t.test('duplicate report ID', () => {
    assert.throws(
      () =>
        checkConformanceExpectedFailures(
          report([result(EXPECTED_ID, 'fail'), result(EXPECTED_ID, 'fail')]),
          manifest(),
        ),
      /Malformed report: duplicate vector IDs:[\s\S]*known-gap/,
    );
  });

  await t.test('duplicate manifest ID', () => {
    assert.throws(
      () =>
        checkConformanceExpectedFailures(
          report([result(EXPECTED_ID, 'fail')]),
          {
            ...manifest(),
            expected_failures: [EXPECTED_ID, EXPECTED_ID],
          },
        ),
      /Malformed manifest: duplicate expected-failure IDs:[\s\S]*known-gap/,
    );
  });

  await t.test('duplicate inventory ID', () => {
    assert.throws(
      () =>
        checkConformanceExpectedFailures(
          report([result(PASS_ID, 'pass'), result(EXPECTED_ID, 'fail')]),
          {
            ...manifest(),
            expected_vector_ids: [PASS_ID, EXPECTED_ID, PASS_ID],
          },
        ),
      /Malformed manifest: duplicate expected-vector IDs:[\s\S]*core\/join\/basic/,
    );
  });
});

test('rejects malformed report and manifest shapes', async (t) => {
  await t.test('malformed report', () => {
    assert.throws(
      () => checkConformanceExpectedFailures({ counts: {}, results: 'not-an-array' }, manifest()),
      /Malformed report: `results` must be an array/,
    );
  });

  await t.test('malformed manifest', () => {
    assert.throws(
      () =>
        checkConformanceExpectedFailures(
          report([result(EXPECTED_ID, 'fail')]),
          { tracking_issue: '', expected_vector_ids: [EXPECTED_ID], expected_failures: [EXPECTED_ID] },
        ),
      /Malformed manifest: `tracking_issue` must be a non-empty string/,
    );
  });
});
