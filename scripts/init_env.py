"""Prepare local Compose configuration without printing or replacing existing secrets."""
import re
import secrets
from pathlib import Path


root = Path(__file__).resolve().parents[1]
target = root / ".env"
content = target.read_text(encoding="utf-8-sig") if target.exists() else (root / ".env.example").read_text(encoding="utf-8")
match = re.search(r"^JWT_SECRET=(.*)$", content, flags=re.MULTILINE)
if match is None:
    content = content.rstrip() + "\nJWT_SECRET=" + secrets.token_urlsafe(48) + "\n"
elif not match.group(1).strip().strip("\"'"):
    content = re.sub(r"^JWT_SECRET=.*$", lambda _: "JWT_SECRET=" + secrets.token_urlsafe(48), content, flags=re.MULTILINE)
target.write_text(content, encoding="utf-8")
target.chmod(0o600)
print("Local .env configured. Existing values are preserved; the signing key is not printed.")
