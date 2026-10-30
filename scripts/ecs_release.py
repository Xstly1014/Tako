"""Transfer a committed release without secrets; promote using the existing ECS volume."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parent.parent


def run(args, timeout=600):
    result=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError('release_operation_failed')
    return result.stdout


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--host',required=True)
    parser.add_argument('--identity',type=Path,required=True)
    args=parser.parse_args()
    assert re.fullmatch('[a-zA-Z0-9.-]+',args.host)
    version=run(['git','rev-parse','HEAD']).decode().strip()
    assert re.fullmatch('[a-f0-9]{40}',version)
    # Deployment code must be the reviewed commit; user-owned untracked reviews are irrelevant.
    assert not run(['git','diff','HEAD','--','backend','frontend','infra','scripts'])
    directory=ROOT/'.runtime/releases'/version
    directory.mkdir(parents=True,exist_ok=True)
    images={}
    for kind in ('api','web'):
        tag='writing-community-'+kind+':'+version
        run(['docker','tag','writing-community-'+kind+':local',tag])
        images[kind]=run(['docker','image','inspect',tag,'--format','{{.Id}}']).decode().strip()
    archive=directory/'images.tar'
    run(['docker','save','-o',str(archive),*[f'writing-community-{k}:{version}' for k in ('api','web')]])
    plan=dict(version=version,images=images,volume='tako-ecs-test_mysql_data')
    (directory/'plan.json').write_text(json.dumps(plan))
    bundle=directory/'release.tar.gz'
    with tarfile.open(bundle,'w:gz') as out:
        for source,target in [('infra/compose.ecs-production.yaml','compose.yaml'),('infra/nginx.production.conf','nginx.conf'),
                              ('scripts/ecs_promote.py','ecs_promote.py')]:
            out.add(ROOT/source,arcname=target)
        for source in (ROOT/'backend/migrations').glob('*.sql'):
            out.add(source,arcname='migrations/'+source.name)
        for name in ('recovery.py','oss_backup.py','daily_backup.py'):
            out.add(ROOT/'scripts'/name,arcname='scripts/'+name)
        out.add(directory/'plan.json',arcname='plan.json')
    identity=str(args.identity.resolve())
    ssh=['ssh','-i',identity,'-o','BatchMode=yes','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=yes','root@'+args.host]
    remote='/opt/tako/releases/'+version
    run(ssh+['install -d -m 700 '+remote])
    scp=['scp','-q','-i',identity,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes']
    for path in (archive,bundle):
        run(scp+[str(path),'root@'+args.host+':'+remote+'/'+path.name])
        digest=hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
        actual=run(ssh+['sha256sum '+remote+'/'+path.name]).decode().split()[0]
        assert actual==digest
    # Bundle contains only locally constructed fixed paths. Remote tar never receives user names.
    run(ssh+['cd '+remote+' && tar -xzf release.tar.gz && docker load -i images.tar >/dev/null'])
    print(json.dumps({'event':'release_images_verified','version':version}),flush=True)
    output=run(ssh+['python3 '+remote+'/ecs_promote.py'],timeout=900)
    for line in output.decode().splitlines():
        event=json.loads(line)
        print(json.dumps(event),flush=True)


if __name__=='__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event':'ecs_release_failed','hint':'Inspect private release state and redacted remote status before retrying.'}))
        raise SystemExit(1)
