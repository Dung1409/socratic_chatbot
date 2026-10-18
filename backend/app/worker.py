import logging
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from .db import Database
from .extraction import ExtractionError
from .jobs import JobQueue
from . import config

logger = logging.getLogger("socratic.worker")
HEARTBEAT = Path("/tmp/socratic-worker-heartbeat") if os.name != "nt" else Path(os.environ.get("TEMP", ".")) / "socratic-worker-heartbeat"


def extract_isolated(filename, data):
    # subprocess.run kills and waits for the parser when its deadline expires.
    result = subprocess.run(
        [sys.executable, "-m", "backend.app.extraction", Path(filename).suffix.lower()],
        input=data, capture_output=True, timeout=config.positive_integer("WORKER_JOB_TIMEOUT_SECONDS", 300),
    )
    if result.returncode:
        raise RuntimeError("Parser process failed")
    payload = json.loads(result.stdout)
    if "error" in payload:
        raise ExtractionError(payload["error"], payload["status_code"])
    return payload


def process_one(queue: JobQueue, heartbeat: Path | None = None):
    job = queue.claim()
    if heartbeat is not None:
        heartbeat.touch()
    if job is None:
        return False
    stopped = threading.Event()

    def keep_lease():
        while not stopped.wait(min(queue.lease_seconds / 3, 10)):
            try:
                if not queue.renew(job):
                    return
                if heartbeat is not None:
                    heartbeat.touch()
            except Exception:
                logger.warning("Lease renewal failed job_id=%s", job["id"])
                return

    renewal = threading.Thread(target=keep_lease, daemon=True)
    renewal.start()
    try:
        # File parsing happens outside a database transaction.
        result = extract_isolated(job["filename"], queue.read_file(job))
        accepted = queue.finish(job, text=result["text"], pages=result["pages"],
                                warnings=result["warnings"])
        logger.info("Extraction finished job_id=%s accepted=%s", job["id"], accepted)
    except ExtractionError as exc:
        queue.finish(job, error=str(exc))
        logger.info("Invalid document job_id=%s", job["id"])
    except Exception:
        queue.finish(job, error="Không xử lý được tệp. Vui lòng thử lại sau.", retryable=True)
        logger.warning("Extraction will retry if attempts remain job_id=%s", job["id"])
    finally:
        stopped.set()
        renewal.join(timeout=6)
    return True


def check_health():
    if not HEARTBEAT.exists() or time.time() - HEARTBEAT.stat().st_mtime > 60:
        raise RuntimeError("Worker heartbeat is stale")
    Database.from_env().check_ready()
    config.check_storage(config.storage_path())


def run():
    db = Database.from_env()
    config.validate_runtime(db, worker=True)
    if config.auto_migrate():
        db.initialize()
    else:
        db.check_ready()
    queue = JobQueue(db, config.storage_path())
    queue.storage_path.mkdir(parents=True, exist_ok=True)
    config.check_storage(queue.storage_path)
    shutdown = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: shutdown.set())
    HEARTBEAT.unlink(missing_ok=True)
    logger.info("Worker started database=%s", "postgresql" if db.postgres else "sqlite")
    try:
        while not shutdown.is_set():
            try:
                if not process_one(queue, HEARTBEAT):
                    shutdown.wait(1)
            except Exception:
                # Do not log DSNs, credentials, file contents, or parser tracebacks.
                logger.warning("Worker could not reach the job queue")
                shutdown.wait(5)
    finally:
        HEARTBEAT.unlink(missing_ok=True)


def main():
    config.configure_logging()
    try:
        run()
    except Exception as exc:
        logger.error("Worker stopped error_type=%s", type(exc).__name__)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
