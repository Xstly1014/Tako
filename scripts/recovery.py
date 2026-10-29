"""Encrypted local backup and isolated MySQL restore drill. No plaintext dump on disk.

Requires Python 3 and cryptography. Run from the repository root. The production
database is never a restore target. Dumps contain private data: keep the separate
BACKUP_ENCRYPTION_KEY in a password manager, not alongside the encrypted backup.
"""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from datetime import datetime, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
MAGIC = b"TAKO_BACKUP_V1\x00"


def config():
    values = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip('"').strip("'")
    return {**values, **os.environ}


def run(args, data=None, env=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, cwd=ROOT, env=env, timeout=180)
    if result.returncode:
        # Do not expose SQL, database credentials or plaintext in exception output.
        raise RuntimeError("container_operation_failed")
    return result.stdout


def sql(query, container=None):
    if container:
        args = ["docker", "exec", "-i", container, "sh", "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B --raw writing_restore']
    else:
        args = ["docker", "compose", "exec", "-T", "mysql", "sh", "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B --raw "$MYSQL_DATABASE"']
    return run(args, query.encode()).decode()


def fingerprint(container=None):
    result = {}
    # Every field participates, including draft content, revisions and mutation acks.
    tables = sql("SHOW TABLES", container).splitlines()
    for table in tables:
        if table == "runtime_health":
            continue  # Ephemeral process heartbeats change independently of user data.
        if not table.replace("_", "").isalnum():
            raise RuntimeError("unexpected_table_identifier")
        columns = [line.split("\t")[0] for line in sql(f"SHOW COLUMNS FROM `{table}`", container).splitlines()]
        parts = [f"IF(`{c}` IS NULL,'N',CONCAT('V',LENGTH(HEX(`{c}`)),':',HEX(`{c}`)))" for c in columns]
        rows = sql(f"SELECT SHA2(CONCAT({','.join(parts)}),256) FROM `{table}` ORDER BY 1", container)
        result[table] = {"rows": len(rows.splitlines()), "sha256": hashlib.sha256(rows.encode()).hexdigest()}
    return result


def key():
    value = bytes.fromhex(config().get("BACKUP_ENCRYPTION_KEY", ""))
    if len(value) != 32:
        raise RuntimeError("backup_key_required")
    return value


def backup():
    before = fingerprint()
    dump = run(["docker", "compose", "exec", "-T", "mysql", "sh", "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF --hex-blob --default-character-set=utf8mb4 "$MYSQL_DATABASE"'])
    after = fingerprint()
    if before != after:
        raise RuntimeError("database_changed_retry_during_quiet_period")
    created = datetime.now(timezone.utc).isoformat()
    payload = gzip.compress(json.dumps({"created_at": created, "manifest": before,
                                       "sql": base64.b64encode(dump).decode()}).encode())
    nonce = secrets.token_bytes(12)
    encrypted = MAGIC + nonce + AESGCM(key()).encrypt(nonce, payload, MAGIC)
    directory = ROOT / "backups"
    directory.mkdir(exist_ok=True)
    path = directory / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4) + ".tako.enc")
    with path.open("xb") as output:
        output.write(encrypted)
    print(json.dumps({"event": "encrypted_backup_created", "path": str(path), "bytes": len(encrypted)}))
    return path


def load_archive(path):
    data = path.read_bytes()
    if not data.startswith(MAGIC):
        raise RuntimeError("backup_format_invalid")
    offset = len(MAGIC)
    return json.loads(gzip.decompress(AESGCM(key()).decrypt(data[offset:offset+12], data[offset+12:], MAGIC)))


def restore(path):
    started = time.monotonic()
    payload = load_archive(path)
    container = "tako-restore-" + secrets.token_hex(6)
    environment = dict(os.environ, MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32))
    try:
        run(["docker", "run", "-d", "--name", container, "--network", "none", "--tmpfs", "/var/lib/mysql:rw,size=1g",
             "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_DATABASE=writing_restore", "mysql:8.4"], env=environment)
        for _ in range(60):
            try:
                sql("SELECT 1", container)
                break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError("isolated_mysql_not_ready")
        run(["docker", "exec", "-i", container, "sh", "-c",
             'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 writing_restore'], base64.b64decode(payload["sql"]))
        actual = fingerprint(container)
        if actual != payload["manifest"]:
            raise RuntimeError("restored_data_mismatch")
        report = {"event": "isolated_restore_verified", "snapshot_at": payload["created_at"],
                  "backup_file": path.name, "tables": len(actual),
                  "elapsed_seconds": round(time.monotonic()-started, 2),
                  "draft_rows": actual.get("drafts", {}).get("rows", 0),
                  "revision_rows": actual.get("draft_revisions", {}).get("rows", 0),
                  "scope": "local_isolated_container_not_off_machine"}
        (ROOT / ".runtime").mkdir(exist_ok=True)
        (ROOT / ".runtime" / "restore-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    finally:
        # Generated exact container name only; never remove source volumes.
        run(["docker", "rm", "-f", container])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["backup", "restore", "drill"])
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "backup":
            backup()
        elif args.mode == "restore":
            if not args.file:
                raise RuntimeError("backup_file_required")
            restore(args.file.resolve())
        else:
            restore(backup())
    except Exception as error:
        # Only allowlisted local codes; library messages may embed private input.
        allowed = {"container_operation_failed", "backup_key_required", "database_changed_retry_during_quiet_period", "backup_format_invalid", "isolated_mysql_not_ready", "restored_data_mismatch", "backup_file_required"}
        code = str(error) if isinstance(error, RuntimeError) and str(error) in allowed else "backup_authentication_or_dependency_failure"
        print(json.dumps({"event": "recovery_failed", "failure_code": code}))
        raise SystemExit(1)
