"""Check saved draft state through API/web process restart during a quiet period."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery import ROOT, fingerprint

parser = argparse.ArgumentParser()
parser.add_argument("--origin", default="http://localhost:3000")
args = parser.parse_args()


def drafts():
    return {name: value for name, value in fingerprint().items()
            if name in ("drafts", "draft_revisions", "draft_mutations")}


try:
    before = drafts()
    subprocess.run(["docker", "compose", "restart", "api", "web"], cwd=ROOT, check=True)
    for _ in range(30):
        try:
            urllib.request.urlopen(args.origin + "/health/ready", timeout=3).close()
            break
        except Exception:
            time.sleep(1)
    else:
        raise RuntimeError("application_not_ready")
    if before != drafts():
        raise RuntimeError("saved_state_changed_or_concurrent_edit")
    print(json.dumps({"event": "application_restart_verified", "scope": "drafts_revisions_mutation_acks"}))
except Exception:
    print(json.dumps({"event": "restart_verification_failed", "hint": "Check service readiness and concurrent editing; do not infer data loss without investigation."}))
    raise SystemExit(1)
