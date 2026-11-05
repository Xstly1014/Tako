"""Check shelf migration compatibility and rollback refusal in a fresh isolated schema."""
import runpy, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
DB='writing_shelf_migration_test'
def sql(query):
 return subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'),input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
def migrate(command,success=True):
 cmd="""export GOOSE_DBSTRING="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/{db}?@')&multiStatements=true"; go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations {command}""".format(db=DB,command=command)
 r=subprocess.run(compose('run','--rm','tools','sh','-c',cmd),cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if (r.returncode==0)!=success:raise RuntimeError('migration_unexpected_result')
try:
 sql("CREATE DATABASE IF NOT EXISTS "+DB+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON "+DB+".* TO 'tako_test'@'%';")
 if sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='"+DB+"'")!='0':raise RuntimeError('fresh_isolated_database_required')
 migrate('up-to 24')
 sql("USE "+DB+"; SET @owner=UUID_TO_BIN(UUID()),@book=UUID_TO_BIN(UUID()),@chapter=UUID_TO_BIN(UUID()); INSERT INTO accounts(id,email,nickname) VALUES(@owner,'shelf-migration@example.test','migration'); INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(@book,@owner,'preserved shelf book','',JSON_ARRAY('日常')); INSERT INTO novel_chapters(id,novel_id,owner_id) VALUES(@chapter,@book,@owner); INSERT INTO chapter_release_events(chapter_id,novel_id,owner_id,ordinal,published_at) VALUES(@chapter,@book,@owner,1,'2026-11-01 00:00:00.123456');")
 fingerprint="SELECT HEX(chapter_id),HEX(novel_id),HEX(owner_id),ordinal,published_at FROM chapter_release_events ORDER BY chapter_id"
 before=sql("USE "+DB+"; "+fingerprint)
 migrate('up-to 25')
 if sql("USE "+DB+"; "+fingerprint)!=before:raise RuntimeError('legacy_release_changed')
 if sql("USE "+DB+"; SELECT COUNT(*) FROM chapter_release_events WHERE release_sequence>0")!='1':raise RuntimeError('historical_event_sequence_missing')
 migrate('down')
 if sql("USE "+DB+"; "+fingerprint)!=before:raise RuntimeError('empty_rollback_changed_release')
 migrate('up-to 25')
 sql("USE "+DB+"; INSERT INTO novel_shelves(account_id,novel_id,in_shelf,following,revision,generation,start_sequence,added_at,updated_at) SELECT owner_id,id,FALSE,FALSE,1,1,0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6) FROM novels;")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_shelves WHERE in_shelf=FALSE")!='1':raise RuntimeError('rollback_lost_tombstone')
 sql("USE "+DB+"; DELETE FROM novel_shelves; INSERT INTO novel_shelf_requests(account_id,mutation_id,novel_id,payload_hash,result,created_at) SELECT owner_id,UUID_TO_BIN(UUID()),id,UNHEX(REPEAT('00',32)),JSON_OBJECT(),UTC_TIMESTAMP(6) FROM novels;")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM novel_shelf_requests")!='1':raise RuntimeError('rollback_lost_receipt')
 sql("USE "+DB+"; DELETE FROM novel_shelf_requests")
 migrate('down')
 if sql("USE "+DB+"; "+fingerprint)!=before:raise RuntimeError('final_release_changed')
 if sql("USE "+DB+"; SELECT title FROM novels")!='preserved shelf book':raise RuntimeError('legacy_book_changed')
 sql('DROP DATABASE '+DB)
 print('PASS shelf migration: 24->25->24/re-upgrade preserves legacy event identity and timestamp; relation tombstone or receipt refuses rollback. Isolated synthetic schema only.')
except Exception:
 print('FAIL shelf migration; isolated database retained for inspection; application database unchanged.')
 raise SystemExit(1)
