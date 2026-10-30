"""Upload encrypted backup, download it again, then verify isolated restoration."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery import ROOT, backup, config, restore, load_archive


def require_private(executable, environment, bucket, object_key, repair=False):
    if repair:
        result = subprocess.run([str(executable), "api", "put-object-acl", "--bucket", bucket,
                                 "--key", object_key, "--object-acl", "private", "--retry-times", "0"],
                                env=environment, cwd=ROOT, capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError("object_acl_update_failed")
    result = subprocess.run([str(executable), "api", "get-object-acl", "--bucket", bucket,
                             "--key", object_key, "--output-format", "json", "--retry-times", "0"],
                            env=environment, cwd=ROOT, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError("object_acl_check_failed")
    decoded, _ = json.JSONDecoder().raw_decode(result.stdout.decode().lstrip())
    def private(value):
        if isinstance(value, dict):
            return any((name.lower() in ("acl", "grant") and item == "private") or private(item)
                       for name, item in value.items())
        if isinstance(value, list):
            return any(private(item) for item in value)
        return False
    if not private(decoded):
        raise RuntimeError("object_not_explicitly_private")
    url = "https://" + bucket + ".oss-" + environment["OSS_REGION"] + ".aliyuncs.com/" + object_key
    try:
        urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20).close()
    except urllib.error.HTTPError as error:
        if error.code == 403:
            return
        raise RuntimeError("anonymous_access_result_unexpected") from None
    raise RuntimeError("backup_object_publicly_readable")


def object_prefix(values):
    prefix = values.get("OSS_BACKUP_PREFIX", "tako-backups/")
    if not re.fullmatch(r"tako-backups/(?:[a-z0-9_-]+/)*", prefix):
        raise RuntimeError("backup_prefix_invalid")
    return prefix


def main(path=None, restore_data=True):
    values = config()
    required = ("OSS_REGION", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET")
    if any(not values.get(name) for name in required):
        raise RuntimeError("oss_configuration_required")
    if not re.fullmatch(r"[a-z0-9-]{3,63}", values["OSS_BUCKET"]):
        raise RuntimeError("bucket_invalid")
    if not re.fullmatch(r"[a-z0-9-]+", values["OSS_REGION"]):
        raise RuntimeError("region_invalid")
    executable = Path(values.get("OSSUTIL_PATH", str(ROOT / ".runtime/tools/ossutil.exe")))
    if not executable.is_file():
        raise RuntimeError("official_ossutil_required")
    # Never put credentials in command arguments, logs, or the encrypted object.
    environment = dict(os.environ)
    for name in ("OSS_REGION", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_SESSION_TOKEN"):
        if values.get(name):
            environment[name] = values[name]
    environment["OSS_ENDPOINT"] = "https://oss-" + values["OSS_REGION"] + ".aliyuncs.com"
    path = Path(path).resolve() if path else backup()
    if not path.name.endswith(".tako.enc") or not path.read_bytes().startswith(b"TAKO_BACKUP_V1\x00"):
        raise RuntimeError("encrypted_backup_required")
    object_key = object_prefix(values) + path.name
    destination = "oss://" + values["OSS_BUCKET"] + "/" + object_key
    downloaded = ROOT / ".runtime/downloads" / path.name
    downloaded.parent.mkdir(parents=True, exist_ok=True)
    for index, args in enumerate(([str(executable), "cp", str(path), destination, "--acl", "private", "--retry-times", "2"],
                 [str(executable), "cp", destination, str(downloaded), "--retry-times", "2"])):
        result = subprocess.run(args, env=environment, cwd=ROOT, capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError("oss_transfer_failed")
        if index == 0:
            require_private(executable, environment, values["OSS_BUCKET"], object_key)
    if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(downloaded.read_bytes()).digest():
        raise RuntimeError("download_checksum_mismatch")
    if restore_data:
        restore(downloaded)
    else:
        load_archive(downloaded)  # Verify authenticated encryption without a second DB on a small ECS.
    report = {"event": "oss_roundtrip_restore_verified" if restore_data else "oss_roundtrip_integrity_verified",
              "object": object_key}
    (ROOT / ".runtime/oss-report.json").write_text(json.dumps(report), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    try:
        main(sys.argv[1] if len(sys.argv) > 1 else None)
    except Exception:
        print(json.dumps({"event": "oss_backup_failed", "hint": "Check local configuration, private bucket permissions, region, official tool and connectivity."}))
        raise SystemExit(1)
