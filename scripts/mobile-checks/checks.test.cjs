const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

test('contract gate accepts formatting, rejects stale types and broken source, never rewrites input', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-contract-gate-'));
  try {
    for (const file of ['scripts/check_mobile_contract.cjs', 'scripts/mobile-checks/package.json',
      'backend/internal/contract/openapi.yaml', 'mobile/src/api/contract.d.ts']) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(fixture, file));
    }
    fs.symlinkSync(path.join(__dirname, 'node_modules'),
      path.join(fixture, 'scripts/mobile-checks/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const contract = path.join(fixture, 'mobile/src/api/contract.d.ts');
    const source = path.join(fixture, 'backend/internal/contract/openapi.yaml');
    const original = fs.readFileSync(contract, 'utf8');
    const run = () => spawnSync(process.execPath, [path.join(fixture, 'scripts/check_mobile_contract.cjs')],
      { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(contract, original.replace(/\r?\n/g, '\r\n') + '\r\n');
    const formatted = fs.readFileSync(contract, 'utf8');
    assert.equal(run().status, 0, 'formatting-only changes should match');
    assert.equal(fs.readFileSync(contract, 'utf8'), formatted, 'checker must not rewrite types');
    assert.ok(original.includes('export interface paths'));
    const stale = original.replace('export interface paths', 'export interface StalePaths');
    fs.writeFileSync(contract, stale);
    const drift = run();
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /contract_drift_regenerate_mobile_types/);
    assert.equal(fs.readFileSync(contract, 'utf8'), stale, 'drift must not be auto-fixed');
    fs.writeFileSync(source, 'openapi: [invalid');
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /generator_failed/);
    assert.doesNotMatch(invalid.stderr, /openapi: \[invalid/, 'raw source must not be logged');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('service preflight rejects unavailable, wrong-environment and unseeded endpoints without running tests', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-service-gate-'));
  try {
    const preload = path.join(fixture, 'fetch.cjs');
    for (const example of [
      { body: 'throw new Error("offline");', code: 'local_3300_required_no_tests_run' },
      { body: 'return new Response("{}", {headers:{"X-Tako-Environment":"production"}});', code: 'test_environment_required_no_tests_run' },
      { body: 'return new Response("{}", {headers:{"X-Tako-Environment":"test"}});', code: 'seeded_paginated_community_required_no_tests_run' },
    ]) {
      fs.writeFileSync(preload, 'globalThis.fetch = async url => { if(url !== "http://127.0.0.1:3300/api/community") throw new Error("external_host_forbidden"); ' + example.body + ' };');
      const result = spawnSync(process.execPath,
        ['--require', preload, path.join(root, 'scripts/check_mobile_tests.cjs'), 'service'], {
          encoding: 'utf8', timeout: 10000,
          env: { ...process.env, EXPO_PUBLIC_API_URL: 'https://external.invalid/api' },
        });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(example.code));
      assert.doesNotMatch(result.stdout, /# tests/, 'guard rejection must not launch service tests');
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('model gate rejects skips and new unclassified files, and withholds assertion values', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-model-gate-'));
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'mobile/tests'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/check_mobile_tests.cjs'), path.join(fixture, 'scripts/check_mobile_tests.cjs'));
    const write = (name, body) => fs.writeFileSync(path.join(fixture, 'mobile/tests', name), body);
    // Exercise the CLI as a shell would; do not inherit this test worker's
    // private Node test-runner context into a second independent test runner.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = () => spawnSync(process.execPath, [path.join(fixture, 'scripts/check_mobile_tests.cjs'), 'model'],
      { encoding: 'utf8', timeout: 15000, env });
    write('session.test.ts', 'require("node:test")("passes",()=>{});');
    write('versions.test.ts', 'require("node:test")("version model passes",()=>{});');
    write('author-works.test.ts', 'require("node:test")("author model passes",()=>{});');
    write('publications.test.ts', 'require("node:test")("publication model passes",()=>{});');
    write('comments.test.ts', 'require("node:test").skip("must not pass",()=>{});');
    const skipped = run();
    assert.equal(skipped.status, 1);
    assert.match(skipped.stderr, /empty_or_skipped_tests_are_not_a_pass/);
    write('comments.test.ts', 'require("node:test")("fails",()=>{throw new Error("PRIVATE_ASSERTION_SENTINEL");});');
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /model_tests_failed_details_withheld/);
    assert.doesNotMatch(failed.stdout + failed.stderr, /PRIVATE_ASSERTION_SENTINEL/);
    write('new-feature.test.ts', 'throw new Error("must not execute");');
    const unclassified = run();
    assert.equal(unclassified.status, 1);
    assert.match(unclassified.stderr, /unclassified_test_update_gate/);
    assert.doesNotMatch(unclassified.stdout, /# tests/);
    fs.unlinkSync(path.join(fixture, 'mobile/tests/new-feature.test.ts'));
    fs.unlinkSync(path.join(fixture, 'mobile/tests/versions.test.ts'));
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /classified_test_missing/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
