"""Check notice migration compatibility and rollback refusal in a fresh isolated schema."""
import runpy, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
DB='writing_notice_migration_test'
def sql(query):
 return subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'),input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
def migrate(command,success=True):
 cmd="""export GOOSE_DBSTRING="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/{db}?@')&multiStatements=true"; go -C /go/pkg/mod/github.com/pressly/goose/v3@v3.26.0 run -mod=readonly ./cmd/goose -dir /src/migrations {command}""".format(db=DB,command=command)
 r=subprocess.run(compose('run','--rm','-e','GOPROXY=off','tools','sh','-c',cmd),cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if (r.returncode==0)!=success:raise RuntimeError('migration_unexpected_result')
try:
 sql("CREATE DATABASE IF NOT EXISTS "+DB+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON "+DB+".* TO 'tako_test'@'%';")
 if sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='"+DB+"'")!='0':raise RuntimeError('fresh_isolated_database_required')
 migrate('up-to 25')
 sql("USE "+DB+"; SET @owner=UUID_TO_BIN(UUID()),@book=UUID_TO_BIN(UUID()),@chapter=UUID_TO_BIN(UUID()); INSERT INTO accounts(id,email,nickname) VALUES(@owner,'notice-migration@example.test','migration'); INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(@book,@owner,'preserved notice book','',JSON_ARRAY('日常')); INSERT INTO novel_chapters(id,novel_id,owner_id) VALUES(@chapter,@book,@owner); INSERT INTO chapter_release_events(chapter_id,novel_id,owner_id,ordinal,published_at) VALUES(@chapter,@book,@owner,1,'2026-11-01 00:00:00.123456'); INSERT INTO novel_shelves(account_id,novel_id,in_shelf,following,revision,generation,start_sequence,added_at,updated_at) VALUES(@owner,@book,TRUE,TRUE,1,1,0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));")
 fingerprint="SELECT HEX(chapter_id),HEX(novel_id),HEX(owner_id),ordinal,published_at,release_sequence FROM chapter_release_events ORDER BY chapter_id"
 relation="SELECT HEX(account_id),HEX(novel_id),in_shelf,following,revision,generation,start_sequence,added_at,updated_at FROM novel_shelves"
 before=sql("USE "+DB+"; "+fingerprint+"; "+relation)
 migrate('up-to 26');migrate('down')
 if sql("USE "+DB+"; "+fingerprint+"; "+relation)!=before:raise RuntimeError('rollback_changed_legacy')
 migrate('up-to 26')
 sql("USE "+DB+"; INSERT INTO novel_notices(id,account_id,novel_id,generation,created_at) SELECT UUID_TO_BIN(UUID()),account_id,novel_id,generation,UTC_TIMESTAMP(6) FROM novel_shelves")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_notices")!='1':raise RuntimeError('rollback_lost_notice')
 sql("USE "+DB+"; INSERT INTO novel_notice_deliveries(account_id,novel_id,generation,chapter_id,notice_id) SELECT n.account_id,n.novel_id,n.generation,e.chapter_id,n.id FROM novel_notices n JOIN chapter_release_events e ON e.novel_id=n.novel_id")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_notice_deliveries")!='1':raise RuntimeError('rollback_lost_coverage')
 sql("USE "+DB+"; DELETE FROM novel_notice_deliveries; DELETE FROM novel_notices")
 migrate('down')
 if sql("USE "+DB+"; "+fingerprint+"; "+relation)!=before:raise RuntimeError('final_legacy_changed')
 sql('DROP DATABASE '+DB)
 print('PASS notice migration: 25->26->25 preserves release and shelf; nonempty notice/coverage refuses rollback. Isolated synthetic schema only.')
except Exception:
 print('FAIL notice migration; isolated database retained; application database unchanged.')
 raise SystemExit(1)
