"""Persistent, isolated local synthetic environment. Never reads the root .env."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import uuid
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / ".runtime" / "local-test"
CONFIG = DIRECTORY / ".env"


def compose(*args):
    return ["docker", "compose", "--project-directory", str(ROOT), "--env-file", str(CONFIG),
            "-f", str(ROOT / "infra/compose.local-test.yaml"), *args]


def initialize():
    if CONFIG.exists():
        print("Local test configuration already exists; credentials preserved.")
        return
    existing = subprocess.run(["docker", "volume", "inspect", "tako-local-test_mysql_data"], capture_output=True)
    if existing.returncode == 0:
        raise RuntimeError("test_volume_exists_without_matching_configuration")
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    namespace = uuid.uuid4()
    values = {
        "APP_VERSION": "local", "MYSQL_PASSWORD": secrets.token_hex(24),
        "MYSQL_ROOT_PASSWORD": secrets.token_hex(24), "AUTH_PEPPER": secrets.token_hex(32),
        "MAIL_ENCRYPTION_KEY": secrets.token_hex(32), "TEST_DATASET_ID": str(namespace),
        "OPERATOR_ACCOUNT_IDS": str(uuid.uuid5(namespace, "account/0")),
        "TEST_OPERATOR_PASSWORD": secrets.token_urlsafe(24),
        "TEST_AUTHOR_PASSWORD": secrets.token_urlsafe(24),
        "TEST_READER_PASSWORD": secrets.token_urlsafe(24),
    }
    CONFIG.write_text("# Test-only secrets. Do not copy these to ECS.\n" +
                      "".join(name + "=" + value + "\n" for name, value in values.items()), encoding="utf-8")
    (DIRECTORY / "init-test.sql").write_text("""
SET time_zone='+00:00';
CREATE TABLE synthetic_environment_guard (
 id TINYINT UNSIGNED PRIMARY KEY,
 environment VARCHAR(16) NOT NULL,
 namespace CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 base_time DATETIME(6) NOT NULL,
 generator_version INT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB;
INSERT INTO synthetic_environment_guard(id,environment,namespace,base_time)
 VALUES(1,'test','""" + str(namespace) + """',UTC_TIMESTAMP(6));
CREATE TABLE synthetic_seed_items (
 kind VARCHAR(16) CHARACTER SET ascii NOT NULL,
 ordinal INT UNSIGNED NOT NULL,
 object_id BINARY(16) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(kind,ordinal), UNIQUE KEY seed_object(object_id)
) ENGINE=InnoDB;
CREATE TABLE synthetic_seed_runs (
 id BINARY(16) PRIMARY KEY,
 requested_users INT UNSIGNED NOT NULL,
 requested_works INT UNSIGNED NOT NULL,
 inserted_works INT UNSIGNED NOT NULL DEFAULT 0,
 state VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'running',
 started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 completed_at DATETIME(6) NULL
) ENGINE=InnoDB;
""", encoding="utf-8")
    print("Created independent local-test secrets and database identity; no secrets displayed.")


def run(*args):
    subprocess.run(compose(*args), cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["init", "migrate", "seed", "up", "status"])
    parser.add_argument("--users", type=int, default=1000)
    parser.add_argument("--works", type=int, default=20000)
    args = parser.parse_args()
    if args.action == "init":
        initialize()
        return
    if not CONFIG.exists():
        raise RuntimeError("initialize_local_test_configuration_first")
    if args.action == "migrate":
        run("up", "-d", "--wait", "mysql")
        run("run", "--rm", "tools", "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.26.0", "-dir", "migrations", "up")
    elif args.action == "seed":
        run("run", "--rm", "tools", "go", "run", "./cmd/syntheticdata", "--users", str(args.users), "--works", str(args.works))
    elif args.action == "up":
        run("up", "-d", "api", "web", "gateway")
        print("Test entry: http://127.0.0.1:3300/community ; secrets stay in .runtime/local-test/.env")
    else:
        run("ps")
        with urllib.request.urlopen("http://127.0.0.1:3300/api/community", timeout=15) as response:
            if response.headers.get("X-Tako-Environment") != "test":
                raise RuntimeError("environment_identity_mismatch")
            value = json.load(response)
            print(json.dumps({"environment": "test", "page_items": len(value["items"]),
                              "featured": len(value["featured"]), "tag_counts": value["tags"]}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Local test operation failed; source data and production configuration were not selected.")
        raise SystemExit(1)
