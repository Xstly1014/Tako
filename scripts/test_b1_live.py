"""Disposable real B1 browser/API/MySQL check. Only writing_test is a data target.
Requires: scripts/test_backend.py and docker compose build api web completed.
No real mail is sent; no source volumes or real user accounts are removed.
"""
import argparse
import hashlib
import importlib.util
import json
import secrets
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def run(args, data=None):
    result = subprocess.run(args, input=data, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Do not surface generic Docker/DB errors that might contain credentials.
        if args and str(args[-1]).endswith("browser_smoke.cjs"):
            # Only synthetic writing_test browser assertions; never print SQL/provider errors.
            print(result.stderr.decode(errors="replace")[-1800:])
        raise RuntimeError("b1_command_failed")
    return result.stdout

def sql(text):
    return run(["docker", "compose", "exec", "-T", "mysql", "sh", "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B --default-character-set=utf8mb4 writing_test'], text.encode())

def main(b2=False, restore_check=False, b3=False, password=False):
    config = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            config[k.strip()] = v.strip().strip(chr(34)).strip(chr(39))
    suffix = uuid.uuid4().hex[:10]
    relative = Path(".runtime") / ("b1-test-" + suffix)
    folder = ROOT / relative
    folder.mkdir(parents=True)
    registration_email = uuid.uuid4().hex + "@example.test"
    owner = uuid.uuid4()
    operator = uuid.uuid4()
    operator_token = secrets.token_hex(32)
    token = secrets.token_hex(32)
    names = {"api": "tako-b1-api-" + suffix, "web": "tako-b1-web-" + suffix, "gateway": "tako-b1-gateway-" + suffix}
    created = []
    seeded = False
    try:
        # Fail before touching fixtures if the dedicated DB has not been migrated.
        sql("SELECT COUNT(*) FROM publication_review_tasks;")
        env = {"HTTP_ADDR": ":8080", "AUTH_PEPPER": config["AUTH_PEPPER"], "MAIL_ENCRYPTION_KEY": config["MAIL_ENCRYPTION_KEY"],
               "APP_ORIGIN": "http://localhost:3200", "COOKIE_SECURE": "false", "API_ENABLE_DOCS": "false", "PUBLICATION_ENABLED": "true", "AUTH_MODE": "password" if password else "email", "OPERATOR_ACCOUNT_IDS": str(operator) if b3 else "",
               "MYSQL_DSN": config.get("MYSQL_USER", "writing") + ":" + config["MYSQL_PASSWORD"] +
               "@tcp(mysql:3306)/writing_test?parseTime=true&loc=UTC&time_zone=%27%2B00%3A00%27&timeout=5s&readTimeout=5s&writeTimeout=5s"}
        (folder / "api.env").write_text("".join(k + "=" + v + "\n" for k, v in env.items()), encoding="utf-8")
        (folder / "session.json").write_text(json.dumps({"owner": str(owner), "token": token, "operator":str(operator), "operator_token":operator_token, "registration_email":registration_email}), encoding="utf-8")
        (folder / "nginx.conf").write_text("server { listen 3200; access_log off; error_log /dev/null; client_max_body_size 0; location /api/ { proxy_pass http://" + names["api"] + ":8080; proxy_set_header Host $host; } location / { proxy_pass http://" + names["web"] + ":3000; proxy_set_header Host $http_host; } }", encoding="utf-8")
        sql("INSERT INTO accounts (id,email,nickname) VALUES (X'" + owner.hex + "','" + str(owner) + "@example.test','验收作者');")
        seeded = True
        sql("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (UNHEX('" + hashlib.sha256(token.encode()).hexdigest() + "'),X'" + owner.hex + "',UTC_TIMESTAMP(6)+INTERVAL 1 HOUR);")
        if b3:
            sql("INSERT INTO accounts (id,email,nickname) VALUES (X'"+operator.hex+"','"+str(operator)+"@example.test','验收运营');INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(UNHEX('"+hashlib.sha256(operator_token.encode()).hexdigest()+"'),X'"+operator.hex+"',UTC_TIMESTAMP(6)+INTERVAL 1 HOUR);")
        commands = [
            ["docker", "run", "-d", "--name", names["api"], "--network", "writing-community_default", "--env-file", str(folder / "api.env"), "writing-community-api:local"],
            ["docker", "run", "-d", "--name", names["web"], "--network", "writing-community_default", "-e", "NUXT_PUBLIC_PUBLICATION_ENABLED=true", "-e", "NUXT_PUBLICATION_API_BASE=http://" + names["api"] + ":8080", "writing-community-web:local"],
            ["docker", "run", "-d", "--name", names["gateway"], "--network", "writing-community_default", "-p", "127.0.0.1:3200:3200", "-v", str(folder / "nginx.conf") + ":/etc/nginx/conf.d/default.conf:ro", "nginx:1.28-alpine"],
        ]
        for command in commands:
            command = command[:5] + ["--label", "tako.b1.fixture=" + suffix] + command[5:]
            created.append(command[4])
            run(command)
        browser = ["docker", "run", "--rm", "--network", "container:" + names["gateway"], "-e", "B1_FIXTURE_DIR=/materials/" + relative.as_posix(),
                   "-v", str(ROOT) + ":/materials", "-v", "writing-community_frontend_modules:/app/node_modules", "-w", "/app"]
        if password:
            print(run(browser + ["mcr.microsoft.com/playwright:v1.56.1-noble", "node", "/materials/scripts/password_browser_smoke.cjs"]).decode().strip())
        image_command = ["mcr.microsoft.com/playwright:v1.56.1-noble", "node", "/materials/scripts/b1_browser_smoke.cjs"]
        print(run(browser + image_command).decode().strip())
        result = json.loads((folder / "result.json").read_text(encoding="utf-8"))
        work = uuid.UUID(result["work_id"]).hex
        counts = sql("SELECT (SELECT COUNT(*) FROM work_versions WHERE work_id=X'" + work + "'),(SELECT COUNT(*) FROM publication_review_tasks WHERE work_id=X'" + work + "');")
        if counts.strip() != b"1\t1":
            raise RuntimeError("b1_duplicate_publication")
        if b3:
            b3_command=["mcr.microsoft.com/playwright:v1.56.1-noble","node","/materials/scripts/b3_browser_smoke.cjs"]
            print(run(browser+b3_command).decode().strip())
        if b2:
            b2_command = ["mcr.microsoft.com/playwright:v1.56.1-noble", "node", "/materials/scripts/b2_browser_smoke.cjs"]
            print(run(browser + b2_command).decode().strip())
            sql("UPDATE work_versions SET platform_limited=TRUE WHERE work_id=X'" + work + "' AND version=3; UPDATE works SET author_hidden=TRUE,state_revision=state_revision+1 WHERE id=X'" + work + "';")
            print(run(browser + ["-e", "B2_CHECK_RESTRICTED=true"] + b2_command).decode().strip())
        sql("UPDATE works SET author_hidden=TRUE WHERE id=X'" + work + "';")
        print(run(browser + ["-e", "B1_CHECK_HIDDEN=true"] + image_command).decode().strip())
        print("PASS: B1 original publication remained unique; fixture cleanup follows.")
        if restore_check:
            spec = importlib.util.spec_from_file_location("recovery", ROOT / "scripts" / "recovery.py")
            recovery = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(recovery)
            original = recovery.run
            def test_source(args, data=None, env=None):
                if args[:5] == ["docker", "compose", "exec", "-T", "mysql"]:
                    args = args[:4] + ["-e", "MYSQL_DATABASE=writing_test"] + args[4:]
                return original(args, data, env)
            recovery.run = test_source
            try:
                recovery.restore(recovery.backup())
            finally:
                recovery.run = original
    finally:
        for name in reversed(created):
            # A failed docker run may have created a stopped container. Remove only
            # objects carrying this invocation's exact ownership label.
            probe = subprocess.run(["docker", "inspect", "--format", '{{index .Config.Labels "tako.b1.fixture"}}', name],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if probe.returncode == 0 and probe.stdout.decode().strip() == suffix:
                run(["docker", "rm", "-f", name])
        if seeded:
            cleanup_owners = [owner]
            if password:
                raw = sql("SELECT HEX(id) FROM accounts WHERE email='" + registration_email + "';").decode().strip()
                if raw:
                    cleanup_owners.append(uuid.UUID(hex=raw))
            for cleanup_owner in cleanup_owners:
                value = "X'" + cleanup_owner.hex + "'"
                sql(";".join([
                    "DELETE FROM moderation_mutations WHERE owner_id="+value,
                    "DELETE a FROM moderation_appeals a JOIN moderation_cases c ON c.id=a.case_id WHERE c.owner_id="+value,
                    "DELETE FROM moderation_cases WHERE owner_id="+value,
                    "DELETE FROM work_state_mutations WHERE owner_id=" + value,
                    "DELETE e FROM work_events e JOIN works w ON w.id=e.work_id WHERE w.owner_id=" + value,
                    "DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=" + value,
                    "DELETE FROM publication_mutations WHERE owner_id=" + value,
                    "DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=" + value,
                    "DELETE FROM publication_previews WHERE owner_id=" + value, "DELETE FROM works WHERE owner_id=" + value,
                    "DELETE FROM publication_policies WHERE owner_id=" + value, "DELETE FROM draft_mutations WHERE owner_id=" + value,
                    "DELETE FROM drafts WHERE owner_id=" + value, "DELETE FROM sessions WHERE account_id=" + value,
                    "DELETE FROM accounts WHERE id=" + value, "DELETE FROM sessions WHERE account_id=X'"+operator.hex+"'", "DELETE FROM accounts WHERE id=X'"+operator.hex+"'"]) + ";")
        for filename in ["api.env", "session.json"]:
            path = folder / filename
            if path.exists():
                path.unlink()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--password", action="store_true", help="Real password registration/login and legacy password setup, schema 10")
    parser.add_argument("--b2", action="store_true", help="Include B2 management/browser checks; requires migration 8")
    parser.add_argument("--b3", action="store_true", help="Real separate-operator moderation/appeal browser chain; schema 9")
    parser.add_argument("--restore", action="store_true", help="Also encrypt/restore this synthetic DB in a separate MySQL container")
    try:
        args = parser.parse_args()
        main(args.b2, args.restore, args.b3, args.password)
    except Exception as error:
        print("B1/B2 live test failed (" + type(error).__name__ + "); inspect synthetic fixture logs without exposing credentials.")
        raise SystemExit(1)
