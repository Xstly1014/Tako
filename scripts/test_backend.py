"""Prepare a dedicated integration database; never run cleanup tests in user data."""
import re
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
def config():
    values = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k,v=line.split("=",1); values[k.strip()]=v.strip().strip(chr(34)).strip(chr(39))
    return values

user = config().get("MYSQL_USER", "writing")
if not re.fullmatch(r"[a-zA-Z0-9_]+", user):
    raise SystemExit("MYSQL_USER must be a simple identifier for local test setup")
query = f"CREATE DATABASE IF NOT EXISTS writing_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON writing_test.* TO '{user}'@'%';"
subprocess.run(["docker", "compose", "exec", "-T", "mysql", "sh", "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'], input=query.encode(), cwd=ROOT, check=True)
subprocess.run(["docker", "compose", "run", "--rm", "tools", "sh", "-c",
                'GOOSE_DBSTRING="$TEST_MYSQL_DSN&multiStatements=true" go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up && go test -race -count=1 ./... && go vet ./...'], cwd=ROOT, check=True)
