"""Verify additive migration and rollback refusal in writing_novels_test only."""
from pathlib import Path
import runpy, subprocess, uuid
ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
def sql(query):
 result=subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N writing_novels_test'),input=query.encode(),capture_output=True,check=True)
 return result.stdout.decode().strip()
def migrate(action,success=True,guard=None):
 prefix=r'''export TEST_MYSQL_DSN="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/writing_novels_test?@')"; case "$TEST_MYSQL_DSN" in */writing_novels_test\?*) ;; *) exit 2;; esac; export GOOSE_DBSTRING="$TEST_MYSQL_DSN&multiStatements=true"; '''
 result=subprocess.run(compose('run','--rm','tools','sh','-c',prefix+'go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations '+action),capture_output=True)
 if success: assert result.returncode==0,'isolated_migration_failed'
 else: assert result.returncode!=0 and guard.encode() in result.stderr,'rollback_guard_not_observed'
assert sql('SELECT COUNT(*) FROM novels;')=='0','empty_isolated_book_database_required'
assert sql('SELECT COUNT(*) FROM novel_chapters;')=='0','empty_isolated_chapter_database_required'
owner,book,chapter,draft,legacy=[uuid.uuid4().hex for _ in range(5)]
sql(f"INSERT INTO accounts(id,email,nickname) VALUES(UNHEX('{owner}'),'{owner}@example.test','guard-fixture'); INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(UNHEX('{book}'),UNHEX('{owner}'),'guard-book','','[\"冒险\"]'); INSERT INTO novel_chapters(id,novel_id,owner_id) VALUES(UNHEX('{chapter}'),UNHEX('{book}'),UNHEX('{owner}')); INSERT INTO chapter_drafts(id,owner_id,novel_id,chapter_id,title,content) VALUES(UNHEX('{draft}'),UNHEX('{owner}'),UNHEX('{book}'),UNHEX('{chapter}'),'guard-chapter','synthetic chapter preserved'); UPDATE novel_chapters SET primary_draft_id=UNHEX('{draft}') WHERE id=UNHEX('{chapter}'); INSERT INTO drafts(id,owner_id,title,content) VALUES(UNHEX('{legacy}'),UNHEX('{owner}'),'guard-legacy','synthetic legacy preserved');")
try:
 restore_db="writing_chapter_restore_"+uuid.uuid4().hex[:10]+"_test"
 assert restore_db.startswith("writing_chapter_restore_") and restore_db.endswith("_test")
 dump=subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF --hex-blob writing_novels_test'),capture_output=True,check=True).stdout
 assert b'USE `writing_novels_test`' not in dump and b'CREATE DATABASE' not in dump
 def restore_sql(query):
  result=subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N '+restore_db),input=query.encode(),capture_output=True,check=True)
  return result.stdout.decode().strip()
 subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'),input=('CREATE DATABASE '+restore_db+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;').encode(),capture_output=True,check=True)
 try:
  subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot '+restore_db),input=dump,capture_output=True,check=True)
  assert restore_sql(f"SELECT COUNT(*) FROM chapter_drafts d JOIN novel_chapters c ON c.primary_draft_id=d.id AND c.id=d.chapter_id JOIN novels n ON n.id=c.novel_id WHERE d.id=UNHEX('{draft}') AND n.id=UNHEX('{book}') AND d.content='synthetic chapter preserved';")=='1'
  assert restore_sql(f"SELECT COUNT(*) FROM drafts WHERE id=UNHEX('{legacy}') AND content='synthetic legacy preserved';")=='1'
  print('PASS local MySQL dump restored chapter links/body and legacy draft into a new isolated database')
 finally:
  subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'),input=('DROP DATABASE '+restore_db+';').encode(),capture_output=True,check=True)
 before=sql('SELECT COUNT(*) FROM goose_db_version;')
 migrate('down',False,'tako_chapter_rollback_guard')
 assert sql('SELECT COUNT(*) FROM goose_db_version;')==before
 assert sql(f"SELECT COUNT(*) FROM chapter_drafts WHERE id=UNHEX('{draft}') AND novel_id=UNHEX('{book}') AND content='synthetic chapter preserved';")=='1'
 print('PASS chapter data prevents destructive detach before permanent DDL')
 sql(f"UPDATE novel_chapters SET primary_draft_id=NULL WHERE id=UNHEX('{chapter}'); DELETE FROM chapter_drafts WHERE id=UNHEX('{draft}'); DELETE FROM novel_chapters WHERE id=UNHEX('{chapter}');")
 migrate('down-to 14')
 before=sql('SELECT COUNT(*) FROM goose_db_version;')
 migrate('down',False,'tako_novel_rollback_guard')
 assert sql('SELECT COUNT(*) FROM goose_db_version;')==before
 assert sql(f"SELECT COUNT(*) FROM novels WHERE id=UNHEX('{book}');")=='1'
 print('PASS private book data prevents metadata drop')
 sql(f"DELETE FROM novels WHERE id=UNHEX('{book}');")
 migrate('down-to 13');migrate('up')
 assert sql(f"SELECT COUNT(*) FROM drafts WHERE id=UNHEX('{legacy}') AND content='synthetic legacy preserved';")=='1'
 print('PASS empty 15->13->15 migration; old synthetic middle-form draft preserved')
finally:
 migrate('up')
 # Cleanup only UUIDs created above. No blanket deletion or user database.
 sql(f"UPDATE novel_chapters SET primary_draft_id=NULL WHERE id=UNHEX('{chapter}'); DELETE FROM chapter_drafts WHERE id=UNHEX('{draft}'); DELETE FROM drafts WHERE id=UNHEX('{legacy}'); DELETE FROM novel_chapters WHERE id=UNHEX('{chapter}'); DELETE FROM novels WHERE id=UNHEX('{book}'); DELETE FROM accounts WHERE id=UNHEX('{owner}');")
