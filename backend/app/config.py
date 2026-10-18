"""Shared environment policy for API, migration and worker processes."""
import ipaddress
import logging
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
# Cloud processes receive secrets through their environment, never local files.
if os.getenv("APP_ENV", "development").strip().lower() == "development":
    load_dotenv(ROOT / ".env", override=False)


def production():
    value = os.getenv("APP_ENV", "development").strip().lower()
    if value not in {"development", "test", "production"}:
        raise RuntimeError("APP_ENV must be development, test or production")
    return value == "production"


def boolean(name, default=False):
    value = os.getenv(name, str(default)).strip().lower()
    if value not in {"true", "false"}:
        raise RuntimeError(f"{name} must be true or false")
    return value == "true"


def positive_integer(name, default):
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        raise RuntimeError(f"{name} must be a positive integer") from None
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


def run_mode():
    value = os.getenv("RUN_MODE", "api").strip().lower()
    if value not in {"api", "worker", "combined"}:
        raise RuntimeError("RUN_MODE must be api, worker or combined")
    return value


def auto_migrate():
    enabled = boolean("AUTO_MIGRATE", not production())
    if production() and enabled:
        raise RuntimeError("AUTO_MIGRATE must be false in production; run the migration Job")
    return enabled


def validate_database_url():
    value = os.getenv("DATABASE_URL", "").strip()
    if not value and not production():
        return ""
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme in {"postgres", "postgresql"} and parsed.hostname
                 and parsed.path.strip("/") and parsed.port != 0)
    except ValueError:
        valid = False
    if not valid:
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL with a host and database name")
    return value


def storage_path():
    value = Path(os.getenv("STORAGE_PATH", "/app/storage" if production() else str(ROOT / "backend/data/uploads")))
    if production() and not value.is_absolute():
        raise RuntimeError("STORAGE_PATH must be absolute in production")
    return value


def check_storage(path):
    if production() and sys.platform == "linux" and not os.path.ismount(path):
        raise RuntimeError("STORAGE_PATH must be a mounted volume in production")
    # An actual create/write/read/delete probe catches read-only and broken mounts.
    with tempfile.TemporaryFile(dir=path) as probe:
        probe.write(b"storage-probe")
        probe.seek(0)
        if probe.read() != b"storage-probe":
            raise RuntimeError("Storage read/write check failed")


def origins(name, default):
    values = list(dict.fromkeys(v.strip().rstrip("/") for v in os.getenv(name, default).split(",") if v.strip()))
    if production():
        if not values:
            raise RuntimeError(f"{name} must contain explicit HTTPS origins in production")
        for value in values:
            try:
                parsed = urlsplit(value)
                valid = (parsed.scheme == "https" and parsed.hostname not in {None, "localhost", "127.0.0.1", "::1"}
                         and "*" not in value and not parsed.username and not parsed.password
                         and not parsed.path and not parsed.query and not parsed.fragment)
            except ValueError:
                valid = False
            if not valid:
                raise RuntimeError(f"{name} must contain explicit HTTPS origins without paths or wildcards")
    return values


def trust_proxy_headers():
    return boolean("TRUST_PROXY_HEADERS", False)


def validate_proxy():
    """Return only canonical addresses Uvicorn can interpret; never guess peers."""
    if not trust_proxy_headers():
        return []
    values = os.getenv("FORWARDED_ALLOW_IPS", "").split(",")
    try:
        canonical = []
        for value in values:
            value = value.strip()
            if not value or "%" in value:
                raise ValueError()
            if "/" in value:
                network = ipaddress.ip_network(value, strict=False)
                if network.prefixlen == 0:
                    raise ValueError()
                canonical.append(str(network))
            else:
                canonical.append(str(ipaddress.ip_address(value)))
    except ValueError:
        raise RuntimeError("FORWARDED_ALLOW_IPS must explicitly list trusted proxy IPs/CIDRs; wildcard trust is forbidden") from None
    return list(dict.fromkeys(canonical))


def public_api_origin():
    if not os.getenv("PUBLIC_API_ORIGIN", "").strip():
        return None
    values = origins("PUBLIC_API_ORIGIN", "")
    if len(values) != 1:
        raise RuntimeError("PUBLIC_API_ORIGIN must contain exactly one origin")
    parsed = urlsplit(values[0])
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise RuntimeError("PUBLIC_API_ORIGIN must be an HTTP(S) origin without a path")
    try:
        parsed.port
    except ValueError:
        raise RuntimeError("PUBLIC_API_ORIGIN has an invalid port") from None
    return values[0]


def validate_runtime(database, worker=False):
    auto_migrate()
    positive_integer("WORKER_JOB_TIMEOUT_SECONDS", 300)
    positive_integer("DOCUMENT_AI_TIMEOUT_SECONDS", 30)
    positive_integer("WORKER_PARSER_MEMORY_MB", 512)
    positive_integer("DB_STATEMENT_TIMEOUT_MS", 30000)
    positive_integer("DB_LOCK_TIMEOUT_MS", 5000)
    if not worker:
        validate_proxy()
        positive_integer("AUTH_LOGIN_GLOBAL_LIMIT", 300)
        positive_integer("AUTH_REGISTER_GLOBAL_LIMIT", 60)
        origin = public_api_origin()
        if production() and not trust_proxy_headers() and origin is None:
            raise RuntimeError("PUBLIC_API_ORIGIN is required when TRUST_PROXY_HEADERS=false in production")
    if production():
        validate_database_url()
        if not database.postgres:
            raise RuntimeError("Production requires PostgreSQL")
        if not worker:
            if not boolean("BACKGROUND_JOBS", False):
                raise RuntimeError("BACKGROUND_JOBS must be true in production")
            positive_integer("AI_REQUESTS_PER_HOUR", 60)
            positive_integer("UPLOADS_PER_HOUR", 20)
            if os.getenv("TUTOR_MODE", "openai") == "openai":
                key = os.getenv("OPENAI_API_KEY", "").strip()
                if not key or "replace" in key.lower():
                    raise RuntimeError("OPENAI_API_KEY is required for the production OpenAI tutor")
                if not os.getenv("OPENAI_TUTOR_MODEL", "gpt-6.1-sol").strip() or not os.getenv("OPENAI_ASSESSMENT_MODEL", "gpt-6.1-sol").strip():
                    raise RuntimeError("OpenAI model settings must not be empty")


def configure_logging():
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    if level not in {"INFO", "WARNING", "ERROR"}:
        raise RuntimeError("LOG_LEVEL must be INFO, WARNING or ERROR")
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("socratic").setLevel(level)
    # Provider debug logs and access logs can contain input, headers or query strings.
    for name in ("openai", "httpx", "httpx2", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").disabled = True
