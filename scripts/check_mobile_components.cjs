// Run the colleague-owned fixture scripts without changing their source.
// Mask host modules so every fixture and product component resolves one React.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const selected = process.argv[2] ?? 'all';
const fixtures = { comments: 'mobile-comments-ui', versions: 'mobile-versions-ui' };
const modes = selected === 'all' ? Object.keys(fixtures) : [selected];
let directory;
try {
  if (process.argv.length > 3 || modes.some(mode => !Object.hasOwn(fixtures, mode))) {
    throw new Error('usage_comments_versions_or_all');
  }
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-empty-host-modules-'));
  for (const mode of modes) {
    const script = '/materials/scripts/' + fixtures[mode] + '/run.cjs';
    const result = spawnSync('docker', ['run', '--rm', '--network', 'none',
      '-v', root + ':/materials',
      '-v', 'writing-community_frontend_modules:/tools/node_modules:ro',
      '-v', 'tako-mobile-node-modules:/app/node_modules:ro',
      '-v', directory + ':/materials/mobile/node_modules:ro',
      '-w', '/tools', 'mcr.microsoft.com/playwright:v1.56.1-noble', 'node', script],
    { cwd: root, encoding: 'utf8', timeout: 180000 });
    if (result.error || result.status !== 0) throw new Error(mode + '_fixture_failed');
    console.log('PASS mobile ' + mode + ' component fixtures (network disabled; not device evidence).');
  }
} catch (error) {
  const codes = ['usage_comments_versions_or_all', 'comments_fixture_failed', 'versions_fixture_failed'];
  console.error('FAIL mobile components: ' + (codes.includes(error.message) ? error.message : 'check_docker_and_locked_dependency_volumes'));
  process.exitCode = 1;
} finally {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
}
