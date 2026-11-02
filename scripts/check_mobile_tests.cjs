// Distinct model and live-service gates. Never fall back to fixtures or skips.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2];
const files = {
  model: ['session.test.ts', 'comments.test.ts', 'versions.test.ts'],
  service: ['reader.test.ts', 'comments-service.test.ts', 'versions-service.test.ts'],
};
async function main() {
  if (!files[mode] || process.argv.length !== 3) throw new Error('usage_model_or_service');
  const known = new Set(Object.values(files).flat());
  if (fs.readdirSync(path.join(root, 'mobile/tests')).some(file =>
    file.endsWith('.test.ts') && !known.has(file))) {
    throw new Error('unclassified_test_update_gate');
  }
  if (files[mode].some(file => !fs.existsSync(path.join(root, 'mobile/tests', file)))) {
    throw new Error('classified_test_missing');
  }
  // Override inherited API URLs so this command cannot target an external host.
  if (mode === 'service') {
    let response;
    try {
      response = await fetch('http://127.0.0.1:3300/api/community', { signal: AbortSignal.timeout(10000) });
    } catch { throw new Error('local_3300_required_no_tests_run'); }
    if (!response.ok || response.headers.get('X-Tako-Environment') !== 'test') {
      throw new Error('test_environment_required_no_tests_run');
    }
    const page = await response.json();
    if (!page.items?.length || !page.next_cursor || !page.tags?.length) {
      throw new Error('seeded_paginated_community_required_no_tests_run');
    }
  }
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
    ...files[mode].map(file => path.join(root, 'mobile/tests', file))], {
    cwd: root, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3300/api' },
  });
  // Assertion output can include private values. Print only numeric summaries.
  const summary = (result.stdout ?? '').match(/^# (tests|pass|fail|cancelled|skipped|todo) \d+$/gm) ?? [];
  for (const line of summary) console.log(line);
  if (result.error || result.status !== 0) throw new Error(mode + '_tests_failed_details_withheld');
  if (!summary.some(line => /^# tests [1-9]\d*$/.test(line)) ||
      !summary.includes('# skipped 0') || !summary.includes('# todo 0')) {
    throw new Error('empty_or_skipped_tests_are_not_a_pass');
  }
  console.log('PASS mobile ' + mode + ' tests; no native-device claim.');
}
main().catch(error => {
  const codes = ['usage_model_or_service', 'unclassified_test_update_gate', 'classified_test_missing', 'local_3300_required_no_tests_run',
    'test_environment_required_no_tests_run', 'seeded_paginated_community_required_no_tests_run',
    'model_tests_failed_details_withheld', 'service_tests_failed_details_withheld',
    'empty_or_skipped_tests_are_not_a_pass'];
  console.error('FAIL mobile tests: ' + (codes.includes(error.message) ? error.message : 'check_dependency_or_response_shape'));
  process.exitCode = 1;
});
