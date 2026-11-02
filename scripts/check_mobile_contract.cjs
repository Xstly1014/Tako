// Generate outside the repository and compare syntax, ignoring formatter trivia.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireTool = createRequire(path.join(__dirname, 'mobile-checks/package.json'));

function main() {
  const ts = requireTool('typescript');
  const cli = path.join(path.dirname(requireTool.resolve('openapi-typescript/package.json')), 'bin/cli.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tako-contract-'));
  try {
    const output = path.join(directory, 'contract.d.ts');
    const result = spawnSync(process.execPath, [cli,
      path.join(root, 'backend/internal/contract/openapi.yaml'), '-o', output],
    { cwd: directory, encoding: 'utf8', timeout: 120000 });
    if (result.error || result.status !== 0) throw new Error('generator_failed');
    const canonical = (source) => {
      const file = ts.createSourceFile('contract.d.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      if (file.parseDiagnostics.length) throw new Error('invalid_generated_types');
      return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(file);
    };
    const expected = fs.readFileSync(path.join(root, 'mobile/src/api/contract.d.ts'), 'utf8');
    if (canonical(expected) !== canonical(fs.readFileSync(output, 'utf8'))) {
      throw new Error('contract_drift_regenerate_mobile_types');
    }
    console.log('PASS mobile contract: generated syntax matches OpenAPI; tracked files unchanged.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
try { main(); } catch (error) {
  const codes = ['generator_failed', 'invalid_generated_types', 'contract_drift_regenerate_mobile_types'];
  console.error('FAIL mobile contract: ' + (codes.includes(error.message) ? error.message : 'install_tools_with_npm_ci_in_scripts_mobile_checks'));
  process.exitCode = 1;
}
