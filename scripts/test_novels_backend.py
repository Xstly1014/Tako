"""Run backend regression in a dedicated synthetic MySQL database, never sandbox."""
import runpy
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
compose = runpy.run_path(str(ROOT / 'scripts/local_test.py'))['compose']
query = "CREATE DATABASE IF NOT EXISTS writing_novels_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON writing_novels_test.* TO 'tako_test'@'%';"
subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'), input=query.encode(), check=True)
command = r'''export TEST_MYSQL_DSN="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/writing_novels_test?@')"
case "$TEST_MYSQL_DSN" in */writing_novels_test\?*) ;; *) echo isolated_database_required; exit 2;; esac
export GOOSE_DBSTRING="$TEST_MYSQL_DSN&multiStatements=true"
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up && go test -race -count=1 ./... && go vet ./...'''
subprocess.run(compose('run','--rm','tools','sh','-c',command), cwd=ROOT, check=True)
