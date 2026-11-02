// Standalone C1 route fixture. CI owner integrates this gate separately.
const { spawnSync } = require("node:child_process");
const path = require("node:path"), fs = require("node:fs");
const root = path.resolve(__dirname, ".."), empty = path.join(root, ".runtime/mobile/qa/empty-host-modules");
fs.mkdirSync(empty, { recursive: true });
const result = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", root + ":/materials",
  "-v", "writing-community_frontend_modules:/tools/node_modules:ro", "-v", "tako-mobile-node-modules:/app/node_modules:ro",
  "-v", empty + ":/materials/mobile/node_modules:ro", "-w", "/tools", "mcr.microsoft.com/playwright:v1.56.1-noble", "node", "/materials/scripts/mobile-drafts-ui/run.cjs"],
  { cwd: root, encoding: "utf8", timeout: 180000 });
// Child output is projected to fixed fixture enums; never forward arbitrary logs.
if (result.status === 0 && !result.error) console.log("PASS mobile C1 route fixtures (not native-device evidence).");
else {
  const stage = String(result.stderr).match(/FAIL mobile drafts fixture stage=([a-z-]+)/)?.[1];
  const known = ["bundle", "access-and-create", "creation-sheet", "reopen", "write-failure-and-return", "locked-input-recovery", "uncertain-sync", "publish-handoff-and-return", "handoff-read-retry", "old-journal-priority", "local-conflict-copy", "logout-and-isolation"];
  const line = String(result.stderr).match(/fixture_line=(\d+)/)?.[1];
  if (line) console.error("DIAG C1 fixture_line=" + line);
  console.error("FAIL mobile C1 route fixture stage=" + (known.includes(stage) ? stage : "unavailable")); process.exitCode = 1;
}
