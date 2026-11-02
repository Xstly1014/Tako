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
      { body: 'throw new Error("PRIVATE_SENTINEL",{cause:{code:"ECONNREFUSED"}});', code: 'local_3300_required_no_tests_run', diag: 'stage=connect reason=ECONNREFUSED' },
      { body: 'return new Response("PRIVATE_SENTINEL", {headers:{"X-Tako-Environment":"PRIVATE_SENTINEL"}});', code: 'test_environment_required_no_tests_run', diag: 'stage=environment http_status=200 environment=not_test' },
      { body: 'return new Response("PRIVATE_SENTINEL", {status:503,headers:{"X-Tako-Environment":"test"}});', code: 'test_environment_required_no_tests_run', diag: 'stage=environment http_status=503 environment=test' },
      { body: 'return new Response("PRIVATE_SENTINEL", {headers:{"X-Tako-Environment":"test"}});', code: 'seeded_paginated_community_required_no_tests_run', diag: 'stage=community-json http_status=200 environment=test' },
      { body: 'return new Response("null", {headers:{"X-Tako-Environment":"test"}});', code: 'seeded_paginated_community_required_no_tests_run', diag: 'stage=seed http_status=200 environment=test' },
      { body: 'return new Response(JSON.stringify({items:"PRIVATE_SENTINEL",tags:"PRIVATE_SENTINEL",next_cursor:"PRIVATE_SENTINEL"}), {headers:{"X-Tako-Environment":"test"}});', code: 'seeded_paginated_community_required_no_tests_run', diag: 'stage=seed http_status=200 environment=test' },
      { body: 'return new Response("{}", {headers:{"X-Tako-Environment":"test"}});', code: 'seeded_paginated_community_required_no_tests_run', diag: 'stage=seed http_status=200 environment=test' },
    ]) {
      fs.writeFileSync(preload, 'globalThis.fetch = async url => { if(url !== "http://127.0.0.1:3300/api/community") throw new Error("external_host_forbidden"); ' + example.body + ' };');
      const result = spawnSync(process.execPath,
        ['--require', preload, path.join(root, 'scripts/check_mobile_tests.cjs'), 'service'], {
          encoding: 'utf8', timeout: 10000,
          env: { ...process.env, EXPO_PUBLIC_API_URL: 'https://external.invalid/api' },
        });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(example.code));
      assert.ok(result.stderr.includes(example.diag));
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL/);
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
    fs.mkdirSync(path.join(fixture, 'scripts/mobile-checks'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'mobile/tests'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/check_mobile_tests.cjs'), path.join(fixture, 'scripts/check_mobile_tests.cjs'));
    fs.copyFileSync(path.join(__dirname, 'diagnostics.cjs'), path.join(fixture, 'scripts/mobile-checks/diagnostics.cjs'));
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
    write('drafts-storage.test.ts', 'require("node:test")("draft storage passes",()=>{});');
    write('drafts-sync.test.ts', 'require("node:test")("draft sync passes",()=>{});');
    write('comments.test.ts', 'require("node:test").skip("must not pass",()=>{});');
    const skipped = run();
    assert.equal(skipped.status, 1);
    assert.match(skipped.stderr, /empty_or_skipped_tests_are_not_a_pass/);
    write('comments.test.ts', 'require("node:test")("PRIVATE_TEST_NAME_SENTINEL",()=>{require("node:assert/strict").equal("PRIVATE_ASSERTION_SENTINEL","PRIVATE_EXPECTED_SENTINEL");});');
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /model_tests_failed_details_withheld/);
    assert.match(failed.stderr, /group=model exit=1 reason=nonzero_exit/);
    assert.match(failed.stderr, /test_location=comments\.test\.ts:1:\d+/);
    assert.doesNotMatch(failed.stdout + failed.stderr, /PRIVATE_(ASSERTION|EXPECTED|TEST_NAME)_SENTINEL/);
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

test('component CLI reports approved stage and process failures without forwarding private output', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-component-gate-'));
  try {
    const preload = path.join(fixture, 'docker.cjs');
    fs.writeFileSync(preload, `require('node:child_process').spawnSync = (command,args) => {
      if(command !== 'docker' || args[3] !== 'none') throw Error('unexpected_command');
      return JSON.parse(process.env.TAKO_GATE_FIXTURE_RESULT);
    };`);
    for (const example of [
      { result: { status: 1, stderr: 'PRIVATE_BODY\nPublication fixture failed at remount-read-only: TimeoutError\nPRIVATE_TOKEN' }, expected: 'exit=1 reason=nonzero_exit stage=remount-read-only' },
      { result: { status: 1, stderr: 'Publication fixture failed at PRIVATE_BODY: Error' }, expected: 'exit=1 reason=nonzero_exit stage=unavailable' },
      { result: { status: null, error: { code: 'ENOENT', message: 'PRIVATE_TOKEN' }, stderr: 'PRIVATE_BODY' }, expected: 'exit=none reason=executable_missing stage=unavailable' },
      { result: { status: null, error: { code: 'ETIMEDOUT', message: 'PRIVATE_TOKEN' } }, expected: 'exit=none reason=timeout stage=unavailable' },
    ]) {
      const result = spawnSync(process.execPath,
        ['--require', preload, path.join(root, 'scripts/check_mobile_components.cjs'), 'publication'], {
          encoding: 'utf8', timeout: 10000,
          env: { ...process.env, TAKO_GATE_FIXTURE_RESULT: JSON.stringify(example.result) },
        });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(example.expected));
      assert.match(result.stderr, /publication_fixture_failed/);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_BODY|PRIVATE_TOKEN/);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('diagnostic projections reject unknown stages, paths and error codes', () => {
  const { processState, testLocations, fixtureStage } = require('./diagnostics.cjs');
  assert.equal(processState({status: null, error: {code: 'PRIVATE_SENTINEL'}}), 'exit=none reason=runner_error');
  assert.equal(processState({status: null, error: {code: '__proto__'}}), 'exit=none reason=runner_error');
  assert.equal(processState({status: null, signal: 'PRIVATE_SENTINEL'}), 'exit=none reason=terminated');
  assert.deepEqual(testLocations("  location: 'file:///PRIVATE_SENTINEL/comments.test.ts:12:3'\n  location: 'PRIVATE_SENTINEL/unapproved.test.ts:9:1'", ['comments.test.ts']), ['comments.test.ts:12:3']);
  assert.equal(fixtureStage('comments', 'Stage transfer; page errors ["PRIVATE_SENTINEL"]'), 'transfer');
  assert.equal(fixtureStage('versions', 'Version component stage: failed-switch; page errors: ["PRIVATE_SENTINEL"]'), 'failed-switch');
  assert.equal(fixtureStage('author', 'Author fixture failed at conflict: PRIVATE_SENTINEL'), 'conflict');
  assert.equal(fixtureStage('publication', 'Publication fixture failed at PRIVATE_SENTINEL: Error'), 'unavailable');
});

test('C1 route CLI propagates failure and projects safe stage/line without raw child output', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-drafts-gate-'));
  try {
    const preload = path.join(fixture, 'docker.cjs');
    fs.writeFileSync(preload, `require('node:child_process').spawnSync = (command,args) => {
      if(command !== 'docker' || args[3] !== 'none' || !args.includes('/materials/scripts/mobile-drafts-ui/run.cjs')) throw Error('unexpected_command');
      return JSON.parse(process.env.TAKO_GATE_FIXTURE_RESULT);
    };`);
    for (const example of [
      { result: { status: 1, stderr: 'PRIVATE_BODY\nfixture_line=123\nFAIL mobile drafts fixture stage=publish-handoff-and-return kind=PRIVATE_TOKEN' }, status: 1, expected: 'stage=publish-handoff-and-return' },
      { result: { status: 1, stderr: 'FAIL mobile drafts fixture stage=PRIVATE_BODY kind=PRIVATE_TOKEN' }, status: 1, expected: 'stage=unavailable' },
      { result: { status: null, error: {code: 'ETIMEDOUT', message: 'PRIVATE_TOKEN'}, stderr: 'PRIVATE_BODY' }, status: 1, expected: 'stage=unavailable' },
      { result: { status: 0, stdout: 'PRIVATE_BODY', stderr: 'PRIVATE_TOKEN' }, status: 0, expected: 'PASS mobile C1 route fixtures' },
    ]) {
      const result = spawnSync(process.execPath,
        ['--require', preload, path.join(root, 'scripts/check_mobile_drafts.cjs')], {
          encoding: 'utf8', timeout: 10000,
          env: { ...process.env, TAKO_GATE_FIXTURE_RESULT: JSON.stringify(example.result) },
        });
      assert.equal(result.status, example.status);
      assert.ok((result.stdout + result.stderr).includes(example.expected));
      if (example.result.stderr.includes('fixture_line=123')) assert.match(result.stderr, /DIAG C1 fixture_line=123/);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_BODY|PRIVATE_TOKEN/);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
