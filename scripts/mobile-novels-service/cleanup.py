"""Remove only this fixture's UUID@example.test accounts; never arbitrary user rows."""
import json, re, runpy, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
file=ROOT/'.runtime/novels/service-accounts.json'
if not file.exists(): raise SystemExit('no_fixture_accounts')
rows=json.loads(file.read_text())
assert len(rows)<=2
compose=runpy.run_path(str(ROOT/'scripts/local_test.py'))['compose']
queries=[]
for row in rows:
 email=row['email']
 assert re.fullmatch(r'[0-9a-f-]{36}@example\.test',email)
 # Exact generated email; no user content or credentials appear in command text/log.
 queries.extend([
  f"SET @fixture_id=(SELECT id FROM accounts WHERE email='{email}');",
  "DELETE FROM novel_mutations WHERE owner_id=@fixture_id;",
  "DELETE FROM novels WHERE owner_id=@fixture_id;",
  "DELETE FROM sessions WHERE account_id=@fixture_id;",
  "DELETE FROM accounts WHERE id=@fixture_id;",
 ])
queries.append('SELECT COUNT(*) FROM novels;')
r=subprocess.run(compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N tako_sandbox'),input='\n'.join(queries).encode(),capture_output=True,check=True)
print('fixture accounts removed; remaining private books:',int(r.stdout.decode().strip()))
file.unlink()
