"""Generate a seven-day local test CA and IP certificate; never install trust."""
from datetime import datetime, timedelta, timezone
import ipaddress
from pathlib import Path
import sys
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

root = Path(__file__).resolve().parent.parent
address = ipaddress.ip_address(sys.argv[1])
if not address.is_private:
    raise SystemExit("A private LAN address is required")
folder = root / ".runtime/mobile-certs"
folder.mkdir(parents=True, exist_ok=True)
now = datetime.now(timezone.utc)
if (folder / "ca-key.pem").exists():
    ca_key = serialization.load_pem_private_key((folder / "ca-key.pem").read_bytes(), None)
    ca = x509.load_pem_x509_certificate((folder / "dev-ca.pem").read_bytes())
    if ca.not_valid_after_utc < now + timedelta(days=1):
        raise SystemExit("Existing CA near expiry; remove phone trust before preparing a new CA")
else:
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Tako Local Test CA")])
    ca = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=7))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
          .sign(ca_key, hashes.SHA256()))
    (folder / "ca-key.pem").write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (folder / "dev-ca.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (folder / "dev-ca.cer").write_bytes(ca.public_bytes(serialization.Encoding.DER))
leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
leaf = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, str(address))]))
        .issuer_name(ca.subject).public_key(leaf_key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(minutes=5)).not_valid_after(min(now+timedelta(days=7), ca.not_valid_after_utc))
        .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(address)]),critical=False)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),critical=False)
        .sign(ca_key,hashes.SHA256()))
(folder / "server.pem").write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
(folder / "server-key.pem").write_bytes(leaf_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
p = root / ".env"
lines = [line for line in p.read_text(encoding="utf-8-sig").splitlines() if not line.startswith(("MOBILE_BIND_IP=", "MOBILE_APP_ORIGIN="))]
lines += ["MOBILE_BIND_IP="+str(address), "MOBILE_APP_ORIGIN=https://"+str(address)+":3443"]
p.write_text("\n".join(lines)+"\n",encoding="utf-8")
print("Certificate download: http://"+str(address)+":3444/tako-dev-ca.cer")
print("Phone test URL: https://"+str(address)+":3443/workspace")
print("No system or phone trust changed. CA expires in seven days or less.")
