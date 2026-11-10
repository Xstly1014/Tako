"""Check chapter-comment migration compatibility and rollback refusal in a fresh isolated schema."""
import runpy, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
DB='writing_chapter_comment_migration_test'
def sql(query):
 return subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'),input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
def migrate(command,success=True):
 cmd="""export GOOSE_DBSTRING="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/{db}?@')&multiStatements=true"; go -C /go/pkg/mod/github.com/pressly/goose/v3@v3.26.0 run -mod=readonly ./cmd/goose -dir /src/migrations {command}""".format(db=DB,command=command)
 r=subprocess.run(compose('run','--rm','-e','GOPROXY=off','tools','sh','-c',cmd),cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if (r.returncode==0)!=success:raise RuntimeError('migration_unexpected_result')
try:
 sql("CREATE DATABASE IF NOT EXISTS "+DB+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON "+DB+".* TO 'tako_test'@'%';")
 if sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='"+DB+"'")!='0':raise RuntimeError('fresh_isolated_database_required')
 migrate('up-to 26')
 sql("USE "+DB+"; SET @owner=UUID_TO_BIN(UUID()),@book=UUID_TO_BIN(UUID()),@chapter=UUID_TO_BIN(UUID()),@draft=UUID_TO_BIN(UUID()),@work=UUID_TO_BIN(UUID()); INSERT INTO accounts(id,email,nickname) VALUES(@owner,'chapter-comment-migration@example.test','migration'); INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(@book,@owner,'preserved book','',JSON_ARRAY('日常')); INSERT INTO novel_chapters(id,novel_id,owner_id) VALUES(@chapter,@book,@owner); INSERT INTO drafts(id,owner_id,title,content) VALUES(@draft,@owner,'private draft','private body'); INSERT INTO works(id,owner_id,source_draft_id,created_at) VALUES(@work,@owner,@draft,UTC_TIMESTAMP(6)); INSERT INTO work_comments(id,work_id,author_id,content,created_at) VALUES(UUID_TO_BIN(UUID()),@work,@owner,'preserved original comment',UTC_TIMESTAMP(6));")
 fingerprint="SELECT HEX(id),HEX(work_id),HEX(author_id),content,revision,created_at FROM work_comments; SELECT HEX(id),HEX(owner_id),title FROM novels; SELECT HEX(id),HEX(novel_id),HEX(owner_id) FROM novel_chapters"
 before=sql("USE "+DB+"; "+fingerprint)
 migrate('up-to 27');migrate('down')
 if sql("USE "+DB+"; "+fingerprint)!=before:raise RuntimeError('legacy_changed')
 migrate('up-to 27')
 sql("USE "+DB+"; INSERT INTO chapter_comments(id,novel_id,chapter_id,author_id,content,created_at) SELECT UUID_TO_BIN(UUID()),novel_id,id,owner_id,'new chapter comment',UTC_TIMESTAMP(6) FROM novel_chapters")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM chapter_comments")!='1':raise RuntimeError('rollback_lost_comment')
 sql("USE "+DB+"; INSERT INTO novel_chapters(id,novel_id,owner_id) SELECT UUID_TO_BIN(UUID()),novel_id,owner_id FROM novel_chapters LIMIT 1")
 try:
  sql("USE "+DB+"; SET @root=(SELECT id FROM chapter_comments LIMIT 1); INSERT INTO chapter_comments(id,novel_id,chapter_id,author_id,root_id,reply_to,content,created_at) SELECT UUID_TO_BIN(UUID()),ch.novel_id,ch.id,ch.owner_id,@root,@root,'cross chapter rejected',UTC_TIMESTAMP(6) FROM novel_chapters ch WHERE ch.id<>(SELECT chapter_id FROM chapter_comments WHERE id=@root) LIMIT 1")
  raise RuntimeError('cross_chapter_foreign_key_missing')
 except subprocess.CalledProcessError:pass
 sql("USE "+DB+"; DELETE FROM novel_chapters WHERE id NOT IN(SELECT chapter_id FROM chapter_comments); DELETE FROM chapter_comments; INSERT INTO chapter_comment_mutations(actor_id,mutation_id,payload_hash,result) SELECT id,UUID_TO_BIN(UUID()),UNHEX(REPEAT('00',32)),JSON_OBJECT() FROM accounts")
 migrate('down',False)
 if sql("USE "+DB+"; SELECT COUNT(*) FROM chapter_comment_mutations")!='1':raise RuntimeError('rollback_lost_receipt')
 sql("USE "+DB+"; DELETE FROM chapter_comment_mutations")
 migrate('down')
 if sql("USE "+DB+"; "+fingerprint)!=before:raise RuntimeError('final_legacy_changed')
 sql('DROP DATABASE '+DB)
 print('PASS chapter-comment migration: 26->27->26 preserves old comments/books/chapters; same-chapter FK enforced, nonempty comment or receipt refuses rollback. Isolated schema only.')
except Exception:
 print('FAIL chapter-comment migration; isolated schema retained; application database unchanged.')
 raise SystemExit(1)
