"""Back up ECS, transfer ciphertext off-host, restore locally, optionally verify OSS."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery import ROOT, restore
import oss_backup


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--environment-file", type=Path, required=True,
                        help="local secret config corresponding to this ECS")
    parser.add_argument("--oss", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", args.host):
        raise RuntimeError("host_invalid")
    identity = str(args.identity.resolve())
    values = {}
    for line in args.environment_file.read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip('"').strip("'")
    if len(bytes.fromhex(values.get("BACKUP_ENCRYPTION_KEY", ""))) != 32:
        raise RuntimeError("matching_ecs_backup_key_required")
    result = subprocess.run(["ssh", "-i", identity, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
                             "root@"+args.host, "cd /opt/tako && python3 scripts/recovery.py backup"],
                            capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError("remote_backup_failed")
    events = [json.loads(line) for line in result.stdout.decode().splitlines()]
    event = next(e for e in events if e.get("event") == "encrypted_backup_created")
    filename = Path(event["path"]).name
    if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.tako\.enc", filename):
        raise RuntimeError("remote_backup_filename_invalid")
    directory = ROOT / "backups/ecs"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    result = subprocess.run(["scp", "-q", "-i", identity, "-o", "BatchMode=yes",
                             "root@"+args.host+":/opt/tako/backups/"+filename, str(path)],
                            capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError("encrypted_download_failed")
    previous = os.environ.get("BACKUP_ENCRYPTION_KEY")
    os.environ["BACKUP_ENCRYPTION_KEY"] = values["BACKUP_ENCRYPTION_KEY"]
    try:
        restore(path)
        if args.oss:
            oss_backup.main(path)
    finally:
        if previous is None:
            os.environ.pop("BACKUP_ENCRYPTION_KEY", None)
        else:
            os.environ["BACKUP_ENCRYPTION_KEY"] = previous
    print(json.dumps({"event": "ecs_off_host_restore_verified", "backup_file": filename,
                      "oss_verified": args.oss}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"event": "ecs_backup_failed", "hint": "Check SSH, matching secret config, backup status and optional OSS credentials."}))
        raise SystemExit(1)
