"""Portable Windows Caddy for temporary acceptance, official release SHA256 checked."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
destination = root / ".runtime/tools/caddy.exe"
if destination.exists():
    raise SystemExit("Caddy already present; not replacing the existing binary")
release = json.load(urllib.request.urlopen("https://api.github.com/repos/caddyserver/caddy/releases/tags/v2.11.7", timeout=30))
asset = next(item for item in release["assets"] if item["name"] == "caddy_2.11.7_windows_amd64.zip")
archive = urllib.request.urlopen(asset["browser_download_url"], timeout=90).read()
expected = asset.get("digest", "")
if not expected.startswith("sha256:") or hashlib.sha256(archive).hexdigest() != expected.split(":", 1)[1]:
    raise SystemExit("Official asset SHA256 unavailable or mismatched")
destination.parent.mkdir(parents=True, exist_ok=True)
with destination.open("xb") as output:
    output.write(zipfile.ZipFile(io.BytesIO(archive)).read("caddy.exe"))
print("Official Caddy 2.11.7 verified and installed")
