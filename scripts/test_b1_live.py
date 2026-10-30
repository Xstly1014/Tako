"""Disposable real B1 browser/API/MySQL check. Only writing_test is a data target.
Requires: scripts/test_backend.py and docker compose build api web completed.
No real mail is sent; no source volumes or real user accounts are removed.
"""
import hashlib
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
        raise RuntimeError("b1_command_failed")
    return result.stdout

def sql(text):
    return run(["docker", "compose", "exec", "-T", "mysql", "sh", "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B --default-character-set=utf8mb4 writing_test'], text.encode())

def main():
    config = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            config[k.strip()] = v.strip().strip(chr(34)).strip(chr(39))
    suffix = uuid.uuid4().hex[:10]
    relative = Path(".runtime") / ("b1-test-" + suffix)
    folder = ROOT / relative
    folder.mkdir(parents=True)
    owner = uuid.uuid4()
    token = secrets.token_hex(32)
    names = {"api": "tako-b1-api-" + suffix, "web": "tako-b1-web-" + suffix, "gateway": "tako-b1-gateway-" + suffix}
    created = []
    seeded = False
    try:
        # Fail before touching fixtures if the dedicated DB has not been migrated.
        sql("SELECT COUNT(*) FROM publication_review_tasks;")
        env = {"HTTP_ADDR": ":8080", "AUTH_PEPPER": config["AUTH_PEPPER"], "MAIL_ENCRYPTION_KEY": config["MAIL_ENCRYPTION_KEY"],
               "APP_ORIGIN": "http://localhost:3200", "COOKIE_SECURE": "false", "API_ENABLE_DOCS": "false", "PUBLICATION_ENABLED": "true",
               "MYSQL_DSN": config.get("MYSQL_USER", "writing") + ":" + config["MYSQL_PASSWORD"] +
               "@tcp(mysql:3306)/writing_test?parseTime=true&loc=UTC&time_zone=%27%2B00%3A00%27&timeout=5s&readTimeout=5s&writeTimeout=5s"}
        (folder / "api.env").write_text("".join(k + "=" + v + "\n" for k, v in env.items()), encoding="utf-8")
        (folder / "session.json").write_text(json.dumps({"owner": str(owner), "token": token}), encoding="utf-8")
        (folder / "nginx.conf").write_text("server { listen 3200; access_log off; error_log /dev/null; client_max_body_size 0; location /api/ { proxy_pass http://" + names["api"] + ":8080; proxy_set_header Host $host; } location / { proxy_pass http://" + names["web"] + ":3000; proxy_set_header Host $http_host; } }", encoding="utf-8")
        sql("INSERT INTO accounts (id,email,nickname) VALUES (X'" + owner.hex + "','" + str(owner) + "@example.test','验收作者');")
        seeded = True
        sql("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (UNHEX('" + hashlib.sha256(token.encode()).hexdigest() + "'),X'" + owner.hex + "',UTC_TIMESTAMP(6)+INTERVAL 1 HOUR);")
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
        image_command = ["mcr.microsoft.com/playwright:v1.56.1-noble", "node", "/materials/scripts/b1_browser_smoke.cjs"]
        print(run(browser + image_command).decode().strip())
        result = json.loads((folder / "result.json").read_text())
        work = uuid.UUID(result["work_id"]).hex
        counts = sql("SELECT (SELECT COUNT(*) FROM work_versions WHERE work_id=X'" + work + "'),(SELECT COUNT(*) FROM publication_review_tasks WHERE work_id=X'" + work + "');")
        if counts.strip() != b"1\t1":
            raise RuntimeError("b1_duplicate_publication")
        sql("UPDATE works SET author_hidden=TRUE WHERE id=X'" + work + "';")
        print(run(browser + ["-e", "B1_CHECK_HIDDEN=true"] + image_command).decode().strip())
        print("PASS: one formal version and review task; fixture cleanup follows.")
    finally:
        for name in reversed(created):
            # A failed docker run may have created a stopped container. Remove only
            # objects carrying this invocation's exact ownership label.
            probe = subprocess.run(["docker", "inspect", "--format", '{{index .Config.Labels "tako.b1.fixture"}}', name],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if probe.returncode == 0 and probe.stdout.decode().strip() == suffix:
                run(["docker", "rm", "-f", name])
        if seeded:
            value = "X'" + owner.hex + "'"
            sql(";".join([
                "DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=" + value,
                "DELETE FROM publication_mutations WHERE owner_id=" + value,
                "DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=" + value,
                "DELETE FROM publication_previews WHERE owner_id=" + value, "DELETE FROM works WHERE owner_id=" + value,
                "DELETE FROM publication_policies WHERE owner_id=" + value, "DELETE FROM draft_mutations WHERE owner_id=" + value,
                "DELETE FROM drafts WHERE owner_id=" + value, "DELETE FROM sessions WHERE account_id=" + value,
                "DELETE FROM accounts WHERE id=" + value]) + ";")
        for filename in ["api.env", "session.json"]:
            path = folder / filename
            if path.exists():
                path.unlink()

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("B1 live test failed; inspect test logs and owned temporary resources without exposing credentials.")
        raise SystemExit(1)
