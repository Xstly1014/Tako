"""Restart the existing 3300 test environment without resetting data or reading root .env."""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_test import ROOT, CONFIG, DIRECTORY, compose

DATABASE_VOLUME = "tako-local-test_mysql_data"
CACHES = ("writing-community_go_modules", "writing-community_go_build")
IMAGES = (("writing-community-api:local", "backend"),
          ("writing-community-web:local", "frontend"))


def run(args, timeout=1200):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=timeout)
    if result.returncode:
        # Docker/Compose errors can contain interpolated configuration. Never echo them.
        raise RuntimeError("command_failed_check_docker_and_dependencies")
    return result.stdout


def exists(kind, name):
    return subprocess.run(["docker", kind, "inspect", name], capture_output=True,
                          timeout=20).returncode == 0


def preflight():
    if run(["docker", "info", "--format", "{{.OSType}}"], 30).strip() != b"linux":
        raise RuntimeError("linux_containers_required")
    if not CONFIG.is_file():
        raise RuntimeError("local_test_configuration_missing_do_not_regenerate_over_existing_data")
    if not (DIRECTORY / "init-test.sql").is_file():
        raise RuntimeError("test_identity_sql_missing_restore_matching_local_files")
    # The restart path is deliberately distinct from fresh initialization/restoration.
    if not exists("volume", DATABASE_VOLUME):
        raise RuntimeError("database_volume_missing_choose_restore_or_explicit_fresh_setup")
    values = dict(line.split("=", 1) for line in CONFIG.read_text(encoding="utf-8-sig").splitlines()
                  if "=" in line and not line.lstrip().startswith("#"))
    if values.get("APP_VERSION") != "local":
        raise RuntimeError("unexpected_test_image_version")
    return values


def verify_database(values):
    # Only identity metadata, never user content. Avoid credentials in process arguments.
    query = "SELECT environment,namespace FROM synthetic_environment_guard WHERE id=1;"
    result = subprocess.run(compose("exec", "-T", "mysql", "sh", "-c",
                           'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$MYSQL_DATABASE"'),
                            input=query.encode(), cwd=ROOT, capture_output=True, timeout=30)
    if result.returncode or result.stdout.decode().strip() != "test\t" + values.get("TEST_DATASET_ID", ""):
        raise RuntimeError("database_identity_or_credentials_mismatch_no_reset_performed")


def verify_http():
    for path in ("/health/ready", "/community", "/api/community"):
        with urllib.request.urlopen("http://127.0.0.1:3300" + path, timeout=10) as response:
            if response.status != 200:
                raise RuntimeError("http_readiness_failed")
            if path == "/api/community":
                if response.headers.get("X-Tako-Environment") != "test":
                    raise RuntimeError("http_environment_mismatch")
                data = json.load(response)
                if not isinstance(data.get("items"), list):
                    raise RuntimeError("community_response_invalid")



def verify_maintenance():
    if not run(compose("ps", "--status", "running", "-q", "maintenance"), 30).strip():
        raise RuntimeError("maintenance_not_running")
    query = "SELECT COUNT(*) FROM runtime_health WHERE role='maintenance' AND last_seen > UTC_TIMESTAMP(6)-INTERVAL 120 SECOND AND last_success >= last_seen-INTERVAL 1 SECOND;"
    result = subprocess.run(compose("exec", "-T", "mysql", "sh", "-c",
                           'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$MYSQL_DATABASE"'),
                            input=query.encode(), cwd=ROOT, capture_output=True, timeout=30)
    if result.returncode or result.stdout.strip() != b"1":
        raise RuntimeError("maintenance_heartbeat_unhealthy")


def start(rebuild=False, offline=False):
    values = preflight()
    for name in CACHES:
        if not exists("volume", name):
            run(["docker", "volume", "create", name], 30)
    for image, folder in IMAGES:
        if rebuild or not exists("image", image):
            print("Building " + folder + " image; this may require network access.", flush=True)
            run(["docker", "build", "-f", folder + "/Dockerfile", "-t", image, folder])
    run(compose("up", "-d", "--wait", "--wait-timeout", "180", "mysql"), 210)
    verify_database(values)
    migration = (["-e", "GOPROXY=off", "tools", "go", "-C",
                  "/go/pkg/mod/github.com/pressly/goose/v3@v3.26.0", "run", "-mod=readonly",
                  "./cmd/goose", "-dir", "/src/migrations", "up"] if offline else
                 ["tools", "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.26.0", "-dir", "migrations", "up"])
    run(compose("run", "--rm", *migration))
    run(compose("up", "-d", "api", "web", "gateway", "maintenance"), 180)
    for attempt in range(30):
        try:
            verify_http()
            verify_maintenance()
            break
        except Exception:
            if attempt == 29:
                raise RuntimeError("http_not_ready_after_start") from None
            time.sleep(2)
    print(json.dumps({"event": "local_restart_verified", "environment": "test",
                      "url": "http://127.0.0.1:3300/community", "seeded": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "start"))
    parser.add_argument("--rebuild", action="store_true", help="Rebuild API/Web from current source")
    parser.add_argument("--offline", action="store_true", help="Use pinned existing Go cache only; missing dependencies fail")
    args = parser.parse_args()
    if args.action == "start":
        start(args.rebuild, args.offline)
    else:
        values = preflight()
        verify_database(values)
        verify_http()
        verify_maintenance()
        print(json.dumps({"event": "local_restart_check_passed", "environment": "test"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Only our literal operational codes can be shown. Never dump subprocess errors/config.
        code = str(error) if type(error) is RuntimeError else "dependency_or_http_failure"
        print(json.dumps({"event": "local_restart_failed", "code": code}))
        raise SystemExit(1)
