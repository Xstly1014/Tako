"""Exercise 21->22->23 metadata preservation and the reading-receipt rollback guard in an isolated database."""
import runpy, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
DB='writing_reading_migration_test'
def sql(query):
 return subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'),input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
def migrate(command,success=True):
 cmd="""export GOOSE_DBSTRING="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/{db}?@')&multiStatements=true"; go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations {command}""".format(db=DB,command=command)
 r=subprocess.run(compose('run','--rm','tools','sh','-c',cmd),cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if (r.returncode==0)!=success:raise RuntimeError('migration_unexpected_result')
try:
 sql("CREATE DATABASE IF NOT EXISTS "+DB+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON "+DB+".* TO 'tako_test'@'%';")
 if sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='"+DB+"'")!='0':raise RuntimeError('fresh_isolated_database_required')
 migrate('up-to 21')
 sql("USE "+DB+"; SET @owner=UUID_TO_BIN(UUID()); INSERT INTO accounts(id,email,nickname) VALUES(@owner,'reading-migration@example.test','migration'); INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(UUID_TO_BIN(UUID()),@owner,'preserved book','',JSON_ARRAY('日常'));")
 migrate('up-to 22')
 migrate('down')
 if sql("USE "+DB+"; SELECT title FROM novels")!='preserved book':raise RuntimeError('legacy_book_changed')
 migrate('up-to 22')
 sql("USE "+DB+"; INSERT INTO novel_reading_requests(account_id,mutation_id,novel_id,payload_hash,result) SELECT owner_id,UUID_TO_BIN(UUID()),id,UNHEX(REPEAT('00',32)),JSON_OBJECT() FROM novels;")
 migrate('up-to 23')
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_reading_requests WHERE created_at IS NOT NULL")!='1':raise RuntimeError('retention_metadata_missing')
 migrate('down')
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_reading_requests")!='1':raise RuntimeError('metadata_rollback_lost_receipt')
 migrate('up-to 23')
 migrate('down')
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_reading_requests")!='1':raise RuntimeError('rollback_lost_receipt')
 sql('DROP DATABASE '+DB)
 print('PASS reading migration: existing book preserved; 22/23 metadata rollback/re-upgrade preserves receipts; non-empty 22 rollback refused. Isolated synthetic database only.')
except Exception:
 print('FAIL reading migration; isolated database retained for inspection; application database unchanged.')
 raise SystemExit(1)
