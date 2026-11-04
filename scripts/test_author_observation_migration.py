"""Exercise 18->19->18 preservation and the non-empty rollback guard in an isolated database."""
import runpy, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
DB='writing_policy_migration_test'
def sql(query):
 return subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'),input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
def migrate(command,success=True):
 cmd="""export GOOSE_DBSTRING="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/{db}?@')&multiStatements=true"; go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations {command}""".format(db=DB,command=command)
 r=subprocess.run(compose('run','--rm','tools','sh','-c',cmd),cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if (r.returncode==0)!=success:raise RuntimeError('migration_unexpected_result')
try:
 sql("CREATE DATABASE IF NOT EXISTS "+DB+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON "+DB+".* TO 'tako_test'@'%';")
 # Never reset an earlier non-empty drill; the operator must inspect it first.
 if sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='"+DB+"'")!='0':raise RuntimeError('fresh_isolated_database_required')
 migrate('up-to 18')
 sql("USE "+DB+"; SET @owner=UUID_TO_BIN(UUID()); INSERT INTO accounts(id,email,nickname) VALUES(@owner,'policy-migration@example.test','migration'); INSERT INTO publication_policies(owner_id,observation_until) VALUES(@owner,'2030-01-01 00:00:00');")
 migrate('up-to 19')
 if sql("USE "+DB+"; SELECT CONCAT(revision,':',reason,':',observation_until) FROM publication_policies")!='0::2030-01-01 00:00:00.000000':raise RuntimeError('legacy_policy_changed')
 migrate('down')
 if sql("USE "+DB+"; SELECT observation_until FROM publication_policies")!='2030-01-01 00:00:00.000000':raise RuntimeError('legacy_end_changed')
 migrate('up-to 19')
 sql("USE "+DB+"; UPDATE publication_policies SET revision=1,reason='retained decision';")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT reason FROM publication_policies")!='retained decision':raise RuntimeError('rollback_lost_data')
 sql('DROP DATABASE '+DB)
 print('PASS observation migration: legacy end preserved; empty rollback/re-upgrade; non-empty rollback refused. Isolated synthetic database only.')
except Exception:
 print('FAIL observation migration; isolated database retained for inspection; no application database was reset.')
 raise SystemExit(1)
