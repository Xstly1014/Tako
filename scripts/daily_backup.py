"""Linux systemd job: encrypted OSS roundtrip, durable result, bounded local retention."""
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery import ROOT, backup
import oss_backup

status_path = ROOT / "state/backup/status.json"


def write_status(value):
    temporary = status_path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o644)  # Operational timestamps only; monitor mounts this directory read-only.
    temporary.replace(status_path)


def prune(directory, cutoff):
    if not directory.exists():
        return
    for candidate in directory.glob("*.tako.enc"):
        match = re.fullmatch(r"([0-9]{8}T[0-9]{6}Z)-[a-f0-9]{8}\.tako\.enc", candidate.name)
        if match and not candidate.is_symlink() and candidate.parent.resolve() == directory.resolve():
            created = datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            if created < cutoff:
                candidate.unlink()


def main():
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.parent.chmod(0o755)
    (ROOT / ".runtime").mkdir(exist_ok=True)
    with (ROOT / ".runtime/backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"event": "backup_already_running"}))
            return
        previous = json.loads(status_path.read_text()) if status_path.exists() else {}
        previous["last_attempt"] = datetime.now(timezone.utc).isoformat()
        previous["last_error"] = "in_progress"
        write_status(previous)
        try:
            path = backup()
            oss_backup.main(path, restore_data=False)
            previous["last_success"] = datetime.now(timezone.utc).isoformat()
            previous["last_error"] = ""
            write_status(previous)
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            # Delete only this tool's aged encrypted files, after off-host verification.
            for directory in (ROOT / "backups", ROOT / ".runtime/downloads"):
                prune(directory, cutoff)
            print(json.dumps({"event": "daily_off_host_backup_verified"}))
        except Exception:
            previous["last_error"] = "backup_failed"
            write_status(previous)
            raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"event": "daily_backup_failed", "failure_code": "backup_or_transfer_failure"}))
        raise SystemExit(1)
