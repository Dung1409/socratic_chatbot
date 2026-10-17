import logging
import os
import signal
import threading
import time
from pathlib import Path

from .db import Database
from .extraction import ExtractionError, extract_document
from .jobs import JobQueue

logger = logging.getLogger("socratic.worker")
HEARTBEAT = Path("/tmp/socratic-worker-heartbeat") if os.name != "nt" else Path(os.environ.get("TEMP", ".")) / "socratic-worker-heartbeat"


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
        result = extract_document(job["filename"], queue.read_file(job))
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


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db = Database.from_env()
    if os.getenv("AUTO_MIGRATE", "true").lower() == "true":
        db.initialize()
    else:
        db.check_ready()
    queue = JobQueue(db, Path(os.getenv("STORAGE_PATH", str(Path(__file__).resolve().parents[1] / "data/uploads"))))
    shutdown = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: shutdown.set())
    HEARTBEAT.unlink(missing_ok=True)
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


if __name__ == "__main__":
    main()
