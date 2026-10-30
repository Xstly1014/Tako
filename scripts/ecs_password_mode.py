"""On-host transition after the existing owner has self-configured a password."""
import json
from pathlib import Path
import subprocess

ROOT=Path('/opt/tako')


def run(args,data=None):
    result=subprocess.run(args,cwd=ROOT,input=data,capture_output=True,timeout=120)
    if result.returncode:
        raise RuntimeError('mode_transition_failed')
    return result.stdout


def main():
    check="SELECT COUNT(*) FROM accounts a JOIN account_passwords p ON p.account_id=a.id WHERE a.email='3151649033@qq.com';"
    count=run(['docker','compose','exec','-T','mysql','sh','-c',
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$MYSQL_DATABASE"'],check.encode()).decode().strip()
    assert count=='1','owner_password_setup_required'
    path=ROOT/'.env'
    old=path.read_text()
    lines=[line for line in old.splitlines() if not line.startswith('AUTH_MODE=')]
    path.write_text('\n'.join(lines+['AUTH_MODE=password'])+'\n')
    path.chmod(0o600)
    try:
        run(['docker','compose','up','-d','api'])
        run(['docker','compose','stop','mail-worker'])
    except Exception:
        path.write_text(old)
        run(['docker','compose','up','-d','api','mail-worker'])
        raise
    report=ROOT/'production-release.json'
    value=json.loads(report.read_text());value['auth_mode']='password';report.write_text(json.dumps(value))
    print(json.dumps({'event':'production_password_mode_enabled','owner_password_present':True,'mail_worker_stopped':True}))


if __name__=='__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event':'production_password_mode_failed'}))
        raise SystemExit(1)
