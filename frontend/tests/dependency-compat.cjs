// Exercise the real transitive consumers when security overrides cross majors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { finished } = require('node:stream/promises');
const nitro = createRequire(require.resolve('nitropack/package.json'));
const archiver = nitro('archiver');
const archiveUtils = createRequire(nitro.resolve('archiver'))('archiver-utils');
const { nodeFileTrace } = nitro('@vercel/nft');
async function files(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tako-dependency-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  for (const name of ['first.txt', '中文.txt', 'ignored.txt'])
    await fs.writeFile(path.join(root, 'assets', name), 'synthetic fixture');
  return root;
}
test('Nitro archive consumers retain glob include/exclude and ZIP entry behavior', async t => {
  const root = await files(t);
  const expanded = archiveUtils.file.expand({ cwd: root, filter: 'isFile' }, ['assets/*.txt', '!**/ignored.txt']);
  assert.deepEqual(expanded.sort(), ['assets/first.txt', 'assets/中文.txt']);
  const archive = archiver('zip'), entries = [], bytes = [];
  archive.on('entry', value => entries.push(value.name));
  archive.on('data', value => bytes.push(value));
  archive.on('warning', error => archive.destroy(error));
  const complete = finished(archive);
  archive.glob('assets/*.txt', { cwd: root, ignore: ['**/ignored.txt'] });
  await Promise.all([complete, archive.finalize()]);
  assert.deepEqual(entries.sort(), ['assets/first.txt', 'assets/中文.txt']);
  assert.equal(Buffer.concat(bytes).readUInt32LE(0), 0x04034b50);
});
test('Nitro node-file-trace discovers dynamic asset paths with upgraded glob', async t => {
  const root = await files(t);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true }));
  await fs.writeFile(path.join(root, 'index.cjs'),
    'require("fs").readFileSync(require("path").join(__dirname, "assets", process.env.TAKO_ASSET || "first.txt"));');
  const trace = await nodeFileTrace([path.join(root, 'index.cjs')], { base: root });
  assert.equal(trace.warnings.size, 0);
  for (const asset of ['assets/first.txt', 'assets/中文.txt']) assert.ok(trace.fileList.has(asset));
});
