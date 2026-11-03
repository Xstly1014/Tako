// Browser fixtures only; all API interactions are mocked and no account is used.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    "container:tako-local-test-gateway-1",
    "-v",
    root + ":/materials",
    "-v",
    "writing-community_frontend_modules:/materials/frontend/node_modules:ro",
    "-e",
    "BASE_URL=http://127.0.0.1:3300",
    "-w",
    "/materials/frontend",
    "mcr.microsoft.com/playwright:v1.56.1-noble",
    "node",
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/novel-ops.spec.ts",
    "--project=chromium",
    "--reporter=line",
    "--output=/materials/.runtime/novel-ops/results",
  ],
  { cwd: root, encoding: "utf8", timeout: 240000 },
);
if (!result.error && result.status === 0)
  console.log(
    "PASS novel operations browser fixtures (mocked API; not real-service or device evidence).",
  );
else {
  const line = String(result.stdout).match(/novel-ops\.spec\.ts:(\d+)/)?.[1];
  console.error(
    "FAIL novel operations browser fixtures" +
      (line ? " test_line=" + Number(line) : ""),
  );
  process.exitCode = 1;
}
