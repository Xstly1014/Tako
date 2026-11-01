"""Dedicated integration database inside the local-test MySQL; no production config."""
import subprocess
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from local_test import compose, ROOT
query="CREATE DATABASE IF NOT EXISTS tako_feedback_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON tako_feedback_test.* TO 'tako_test'@'%';"
result=subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'),input=query.encode(),capture_output=True,cwd=ROOT)
if result.returncode: raise SystemExit('Dedicated test database preparation failed.')
command='export TEST_MYSQL_DSN="$(printf %s "$MYSQL_DSN" | sed "s@/tako_sandbox?@/tako_feedback_test?@")"; export GOOSE_DBSTRING="$TEST_MYSQL_DSN&multiStatements=true"; go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up && go test -race -count=1 ./... && go vet ./...'
raise SystemExit(subprocess.run(compose('run','--rm','tools','sh','-c',command),cwd=ROOT).returncode)
