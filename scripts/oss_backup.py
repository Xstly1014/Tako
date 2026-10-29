"""Upload encrypted backup, download it again, then verify isolated restoration."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery import ROOT, backup, config, restore


def main():
    values = config()
    required = ("OSS_REGION", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET")
    if any(not values.get(name) for name in required):
        raise RuntimeError("oss_configuration_required")
    if not re.fullmatch(r"[a-z0-9-]{3,63}", values["OSS_BUCKET"]):
        raise RuntimeError("bucket_invalid")
    if not re.fullmatch(r"[a-z0-9-]+", values["OSS_REGION"]):
        raise RuntimeError("region_invalid")
    executable = ROOT / ".runtime/tools/ossutil.exe"
    if not executable.is_file():
        raise RuntimeError("official_ossutil_required")
    # Never put credentials in command arguments, logs, or the encrypted object.
    environment = dict(os.environ)
    for name in ("OSS_REGION", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_SESSION_TOKEN"):
        if values.get(name):
            environment[name] = values[name]
    environment["OSS_ENDPOINT"] = "https://oss-" + values["OSS_REGION"] + ".aliyuncs.com"
    path = backup()
    destination = "oss://" + values["OSS_BUCKET"] + "/tako-backups/" + path.name
    downloaded = ROOT / ".runtime/downloads" / path.name
    downloaded.parent.mkdir(parents=True, exist_ok=True)
    for args in ([str(executable), "cp", str(path), destination, "--retry-times", "2"],
                 [str(executable), "cp", destination, str(downloaded), "--retry-times", "2"]):
        result = subprocess.run(args, env=environment, cwd=ROOT, capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError("oss_transfer_failed")
    if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(downloaded.read_bytes()).digest():
        raise RuntimeError("download_checksum_mismatch")
    restore(downloaded)
    report = {"event": "oss_roundtrip_restore_verified", "object": "tako-backups/" + path.name}
    (ROOT / ".runtime/oss-report.json").write_text(json.dumps(report), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"event": "oss_backup_failed", "hint": "Check local configuration, private bucket permissions, region, official tool and connectivity."}))
        raise SystemExit(1)
