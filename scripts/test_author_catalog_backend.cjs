// Dedicated synthetic MySQL database; never resets the local sandbox.
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const compose = ["compose", "--project-directory", root, "--env-file", path.join(root, ".runtime/local-test/.env"), "-f", path.join(root, "infra/compose.local-test.yaml")];
const setup = spawnSync("docker", [...compose, "exec", "-T", "mysql", "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'], {
  input: "CREATE DATABASE IF NOT EXISTS writing_author_catalog_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON writing_author_catalog_test.* TO 'tako_test'@'%';", encoding: "utf8",
});
if (setup.status !== 0) { console.log("catalog_database_setup_failed"); process.exit(1); }
const command = `export TEST_MYSQL_DSN="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/writing_author_catalog_test?@')"
case "$TEST_MYSQL_DSN" in */writing_author_catalog_test\\?*) ;; *) echo isolated_database_required; exit 2;; esac
export GOOSE_DBSTRING="$TEST_MYSQL_DSN&multiStatements=true"
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up && go test -race -count=1 ./... && go vet ./...`;
const log = fs.createWriteStream(path.join(root, ".runtime/author-catalog-backend.log"));
const child = spawn("docker", [...compose, "run", "--rm", "tools", "sh", "-c", command], { cwd: root });
let pending = "";
function capture(data) {
  log.write(data); pending += data.toString();
  const lines = pending.split("\n"); pending = lines.pop();
  for (const line of lines) if (/^(ok\s|\?\s|FAIL|# |isolated_database_required)/.test(line)) console.log(line);
}
child.stdout.on("data", capture); child.stderr.on("data", capture);
child.on("close", code => { log.end(); console.log("backend_exit=" + code); process.exitCode = code || 0; });
