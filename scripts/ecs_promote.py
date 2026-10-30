"""Run on ECS from a verified release directory; preserve the existing database.

No schema rollback or volume deletion. Errors stop the new processes and restart
the old application against additive migrations. Output excludes subprocess logs.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request
import urllib.error

ROOT = Path('/opt/tako')
RELEASE = Path(__file__).resolve().parent
STAGE = 'preflight'


def run(args, data=None, check=True):
    result = subprocess.run(args, input=data, capture_output=True, cwd=ROOT, timeout=240)
    if check and result.returncode:
        raise RuntimeError('operation_failed')
    return result


def compose(*args, old=False):
    config = RELEASE / 'previous/compose.yaml' if old else ROOT / 'compose.yaml'
    return run(['docker', 'compose', '--project-directory', str(ROOT), '--env-file', str(ROOT/'.env'), '-f', str(config), *args])


def emit(event, **fields):
    print(json.dumps(dict(event=event, **fields)), flush=True)


def read_env(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line and not line.lstrip().startswith('#'))


def patch_env(path, updates):
    lines = path.read_text().splitlines()
    lines = [line for line in lines if line.split('=', 1)[0] not in updates]
    path.write_text('\n'.join(lines + [key+'='+value for key,value in updates.items()])+'\n')
    path.chmod(0o600)


def sql(query, old=False):
    config = RELEASE/'previous/compose.yaml' if old else ROOT/'compose.yaml'
    return run(['docker','compose','--project-directory',str(ROOT),'--env-file',str(ROOT/'.env'),'-f',str(config),
                'exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B --raw "$MYSQL_DATABASE"'], query.encode()).stdout.decode().strip()


def probe():
    for attempt in range(40):
        try:
            with urllib.request.urlopen('http://localhost:3100/api/community', timeout=8) as response:
                assert response.headers.get('X-Tako-Environment') == 'production'
                assert isinstance(json.load(response)['items'], list)
            with urllib.request.urlopen('http://localhost:3100/community', timeout=8) as response:
                assert '正式环境'.encode() in response.read()
            for path, status in [('/api/me',401),('/docs/',404),('/openapi.json',404)]:
                try:
                    urllib.request.urlopen('http://localhost:3100'+path, timeout=8)
                    raise RuntimeError('access_check_failed')
                except urllib.error.HTTPError as error:
                    assert error.code == status
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError('health_check_failed')


def main():
    global STAGE
    os.umask(0o077)
    plan = json.loads((RELEASE/'plan.json').read_text())
    version = plan['version']
    assert re.fullmatch('[a-f0-9]{40}',version)
    assert (ROOT/'bin/goose').is_file()
    for kind in ('api','web'):
        actual = run(['docker','image','inspect','writing-community-'+kind+':'+version,'--format','{{.Id}}']).stdout.decode().strip()
        assert actual == plan['images'][kind]
    previous = RELEASE/'previous'
    previous.mkdir(mode=0o700)
    for name in ('.env','.backup.env','compose.yaml','nginx.conf'):
        source = ROOT/name
        if source.exists():
            shutil.copy2(source, previous/name)
    original = read_env(ROOT/'.env')
    mysql_id = compose('ps','-q','mysql',old=True).stdout.decode().strip()
    details = json.loads(run(['docker','inspect',mysql_id]).stdout)[0]
    volumes = [item['Name'] for item in details['Mounts'] if item['Destination']=='/var/lib/mysql']
    assert volumes == [plan['volume']]
    mysql_image = details['Image']
    run(['docker','tag',mysql_image,'tako-mysql:preserved-'+version[:12]])
    account = sql("SELECT LOWER(BIN_TO_UUID(id)) FROM accounts WHERE email='3151649033@qq.com'",old=True)
    assert re.fullmatch('[a-f0-9-]{36}',account)
    spec = importlib.util.spec_from_file_location('recovery',ROOT/'scripts/recovery.py')
    recovery = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recovery)
    changed = False
    run(['systemctl','stop','tako-backup.timer'])
    try:
        STAGE = 'freeze_and_backup'
        compose('stop','gateway','api','web','maintenance','mail-worker','monitor',old=True)
        before = recovery.fingerprint()
        backup = recovery.backup()
        emit('production_upgrade_backup_created', filename=backup.name)
        compose('stop','mysql',old=True)
        STAGE = 'migrate'
        changed = True
        for name in ('compose.yaml','nginx.conf'):
            shutil.copy2(RELEASE/name,ROOT/name)
        (ROOT/'migrations').mkdir(exist_ok=True)
        for source in (RELEASE/'migrations').glob('*.sql'):
            shutil.copy2(source,ROOT/'migrations'/source.name)
        for name in ('recovery.py','oss_backup.py','daily_backup.py'):
            shutil.copy2(RELEASE/'scripts'/name,ROOT/'scripts'/name)
        patch_env(ROOT/'.env',{'APP_VERSION':version,'PRODUCTION_MYSQL_VOLUME':volumes[0],
                  'MYSQL_IMAGE':'tako-mysql:preserved-'+version[:12], 'AUTH_MODE':'email',
                  'OPERATOR_ACCOUNT_IDS':account, 'OSS_BACKUP_PREFIX':'tako-backups/production/'})
        if (ROOT/'.backup.env').exists():
            patch_env(ROOT/'.backup.env',{'OSS_BACKUP_PREFIX':'tako-backups/production/'})
        for name in ('MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD','AUTH_PEPPER','MAIL_ENCRYPTION_KEY','BACKUP_ENCRYPTION_KEY'):
            assert read_env(ROOT/'.env').get(name)==original.get(name)
        changed = True
        compose('up','-d','--wait','mysql')
        compose('run','--rm','migrate')
        STAGE = 'verify_preserved_data'
        after = recovery.fingerprint()
        for table, digest in before.items():
            if table != 'goose_db_version':
                assert after[table] == digest
        assert not any(table.startswith('synthetic_') for table in after)
        assert int(sql('SELECT MAX(version_id) FROM goose_db_version WHERE is_applied=1')) == 11
        STAGE = 'start_and_probe'
        compose('up','-d','api','web','gateway','maintenance','mail-worker')
        probe()
        compose('--profile','ops','up','-d','monitor')
        report = dict(version=version,schema=11,preserved_tables=len(before)-1,
                      pre_upgrade_backup=backup.name,access='private_ssh',auth_mode='email_pending_owner_password')
        (ROOT/'production-release.json').write_text(json.dumps(report))
        emit('production_upgrade_verified',**report)
    except Exception:
        failure_stage = STAGE
        if changed:
            run(['docker','compose','--profile','ops','stop'],check=False)
            for name in ('.env','.backup.env','compose.yaml','nginx.conf'):
                if (previous/name).exists():
                    shutil.copy2(previous/name,ROOT/name)
        # Additive migrations remain; existing tables and data are not rolled back.
        try:
            compose('--profile','ops','up','-d','mysql','api','web','gateway','maintenance','mail-worker','monitor',old=True)
            emit('production_application_rollback_started',failed_stage=failure_stage)
        except Exception:
            emit('production_rollback_requires_attention',failed_stage=failure_stage)
        raise
    finally:
        run(['systemctl','start','tako-backup.timer'],check=False)


if __name__=='__main__':
    try:
        main()
    except Exception:
        emit('production_upgrade_failed',stage=STAGE)
        raise SystemExit(1)
