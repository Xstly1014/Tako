"""Encrypted restore drill exclusively for the independently configured local test stack."""
import json
import secrets
import shutil
import sys
import subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import recovery
from local_test import compose, DIRECTORY, ROOT
STAGE='configuration'

def main():
    global STAGE
    key_path=DIRECTORY/'recovery.key'
    if not key_path.exists():
        key_path.write_text(secrets.token_hex(32),encoding='ascii')
    # Preserve the existing recovery implementation and isolated destination. Adapt only source Compose.
    original_run=recovery.run
    def local_run(args,data=None,env=None):
        if args[:2]==['docker','compose']:
            args=compose(*args[2:])
        return original_run(args,data,env)
    recovery.run=local_run
    recovery.config=lambda:{'BACKUP_ENCRYPTION_KEY':key_path.read_text(encoding='ascii').strip()}
    STAGE='encrypted_snapshot'
    path=recovery.backup()
    folder=ROOT/'backups/local-test';folder.mkdir(parents=True,exist_ok=True)
    destination=folder/path.name
    shutil.move(str(path),str(destination))
    STAGE='isolated_restore'
    recovery.restore(destination)
    print(json.dumps({'event':'local_test_restore_verified','environment':'test','backup_file':destination.name,'off_host':False}))

if __name__=='__main__':
    try:main()
    except Exception as error:
        allowed={'database_changed_retry_during_quiet_period','container_operation_failed','backup_key_required','backup_format_invalid','restored_data_mismatch','isolated_mysql_not_ready'}
        code=str(error) if isinstance(error,RuntimeError) and str(error) in allowed else 'operation_timeout' if isinstance(error,subprocess.TimeoutExpired) else 'configuration_or_dependency_error'
        print(json.dumps({'event':'local_test_restore_failed','stage':STAGE,'code':code,'hint':'Check dedicated test configuration and isolated restore status; no production environment was selected.'}))
        raise SystemExit(1)
