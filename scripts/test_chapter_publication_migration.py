"""N2 migration rehearsal in a newly created, disposable local test database.

Verifies N1 data preservation, refusal to roll back an allocated chapter number,
safe empty-N2 rollback and re-upgrade. No application data is copied or reset.
"""
import re
import runpy
import subprocess
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
database='tako_n2_migration_'+uuid.uuid4().hex
assert re.fullmatch(r'tako_n2_migration_[a-f0-9]{32}',database)

def sql(query, selected=False):
    command=compose('exec','-T','mysql','sh','-c',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N'+(' '+database if selected else ''))
    result=subprocess.run(command,input=query.encode(),capture_output=True,cwd=ROOT)
    if result.returncode:
        raise RuntimeError('migration_rehearsal_sql_failed_details_withheld')
    return result.stdout.decode().strip()

def goose(arguments, success=True):
    command=r'''export GOOSE_DBSTRING="$(printf '%s' "$MYSQL_DSN" | sed 's@/tako_sandbox?@/DATABASE?@')&multiStatements=true"
case "$GOOSE_DBSTRING" in */DATABASE\?*) ;; *) exit 2;; esac
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations ARGS'''
    command=command.replace('DATABASE',database).replace('ARGS',arguments)
    result=subprocess.run(compose('run','--rm','tools','sh','-c',command),capture_output=True,cwd=ROOT)
    if (result.returncode==0)!=success:
        raise RuntimeError('migration_rehearsal_'+arguments.replace(' ','_')+'_unexpected_result_details_withheld')

created=False
try:
    sql(f"CREATE DATABASE {database} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL PRIVILEGES ON {database}.* TO 'tako_test'@'%';")
    created=True
    goose('up-to 15')
    owner,book,chapter,draft=[uuid.uuid4().hex for _ in range(4)]
    sql(f"""INSERT INTO accounts(id,email,nickname) VALUES(UNHEX('{owner}'),'migration@example.test','migration');
INSERT INTO novels(id,owner_id,title,introduction,tags) VALUES(UNHEX('{book}'),UNHEX('{owner}'),'N1 preserved','introduction',JSON_ARRAY('冒险'));
INSERT INTO novel_chapters(id,novel_id,owner_id) VALUES(UNHEX('{chapter}'),UNHEX('{book}'),UNHEX('{owner}'));
INSERT INTO chapter_drafts(id,owner_id,novel_id,chapter_id,title,content) VALUES(UNHEX('{draft}'),UNHEX('{owner}'),UNHEX('{book}'),UNHEX('{chapter}'),'chapter preserved','body preserved');
UPDATE novel_chapters SET primary_draft_id=UNHEX('{draft}') WHERE id=UNHEX('{chapter}');
INSERT INTO chapter_draft_revisions(draft_id,revision,title,content,saved_at) SELECT id,revision,title,content,updated_at FROM chapter_drafts;""",True)
    before=sql('SELECT n.title,d.title,d.content,d.revision FROM chapter_drafts d JOIN novels n ON n.id=d.novel_id;',True)
    goose('up')
    if sql('SELECT COUNT(*) FROM novel_chapters WHERE ordinal IS NULL AND last_version=0 AND display_version=0;',True)!='1':
        raise RuntimeError('private_chapter_gained_publication')
    if sql("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME='chapter_previews_expiry';",True)!='2':
        raise RuntimeError('preview_expiry_index_missing')
    sql('UPDATE novel_chapters SET ordinal=1; UPDATE novels SET last_position=1;',True)
    goose('down',False)
    if sql('SELECT ordinal FROM novel_chapters;',True)!='1' or sql('SELECT COUNT(*) FROM chapter_previews;',True)!='0':
        raise RuntimeError('refused_rollback_changed_data_or_schema')
    sql('UPDATE novel_chapters SET ordinal=NULL; UPDATE novels SET last_position=0;',True)
    goose('down')
    after=sql('SELECT n.title,d.title,d.content,d.revision FROM chapter_drafts d JOIN novels n ON n.id=d.novel_id;',True)
    if before!=after:
        raise RuntimeError('safe_rollback_changed_private_chapter')
    goose('up')
    if sql('SELECT n.title,d.title,d.content,d.revision FROM chapter_drafts d JOIN novels n ON n.id=d.novel_id;',True)!=before:
        raise RuntimeError('reupgrade_changed_private_chapter')
    print('PASS N2 migration: N1 retained; allocated-slot rollback refused; safe rollback and reupgrade retained N1.')
finally:
    if created:
        sql(f'DROP DATABASE {database};')
