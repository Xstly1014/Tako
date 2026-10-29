"""Install the pinned official OSS CLI after checking its published ZIP SHA256."""
import argparse
import hashlib
import io
import os
from pathlib import Path
import platform
import urllib.request
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--destination", type=Path, required=True)
args = parser.parse_args()
variants = {
    "Linux": ("linux-amd64", "57ee4c56796a40144acd6b0b96b53b4ba75e5cec09c01d8d0313c09a5524022f", "ossutil"),
    "Windows": ("windows-amd64", "06ebec1680ce68b1807393e65a1e3f5f99c3b69c9b47c40578a80187da4462c3", "ossutil.exe"),
}
if platform.system() not in variants or platform.machine().lower() not in ("amd64", "x86_64"):
    raise SystemExit("Only Linux/Windows amd64 supported")
variant, expected, filename = variants[platform.system()]
url = "https://gosspublic.alicdn.com/ossutil/v2/2.4.1/ossutil-2.4.1-" + variant + ".zip"
raw = urllib.request.urlopen(url, timeout=90).read()
if hashlib.sha256(raw).hexdigest() != expected:
    raise SystemExit("Official archive checksum mismatch")
archive = zipfile.ZipFile(io.BytesIO(raw))
matches = [name for name in archive.namelist() if name == filename or name.endswith("/" + filename)]
if len(matches) != 1:
    raise SystemExit("Unexpected official archive layout")
args.destination.parent.mkdir(parents=True, exist_ok=True)
with args.destination.open("xb") as output:
    output.write(archive.read(matches[0]))
if os.name != "nt":
    args.destination.chmod(0o755)
print("Official ossutil 2.4.1 archive verified and binary installed")
