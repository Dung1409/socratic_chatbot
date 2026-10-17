"""One API and one worker, supervised without a shell or an external daemon."""
import json
import logging
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time

from . import config
from .entrypoint import api_command

logger = logging.getLogger("socratic.combined")
STATE = Path(tempfile.gettempdir()) / "socratic-combined.json"


def _write_state(children):
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps({"supervisor": os.getpid(),
                                     **{name: child.pid for name, child in children.items()}}), encoding="utf-8")
    temporary.replace(STATE)


def check_health():
    """Only local process, queue heartbeat, database and storage checks; no AI call."""
    if os.name != "posix":
        raise RuntimeError("Combined mode requires a POSIX container")
    state = json.loads(STATE.read_text(encoding="utf-8"))
    for name in ("supervisor", "api", "worker"):
        pid = state[name]
        if not isinstance(pid, int) or pid <= 0:
            raise RuntimeError("Invalid combined process state")
        os.kill(pid, 0)
        if sys.platform == "linux":
            # kill(pid, 0) alone also succeeds for a zombie.
            status = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
            if status in {"Z", "X"}:
                raise RuntimeError("Combined child is not running")
    from .worker import check_health as worker_health
    worker_health()


def _subreaper():
    if sys.platform == "linux":
        import ctypes
        # Also adopt orphaned parsers when invoked beneath an init process in tests.
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            raise RuntimeError("Cannot enable child subreaper")


def _kill_group(child):
    try:
        if os.name == "posix":
            os.killpg(child.pid, signal.SIGKILL)
        elif child.poll() is None:
            child.kill()
    except ProcessLookupError:
        pass


def _reap_orphans():
    if os.name != "posix":
        return
    # Direct children have already been waited for. Reap adopted parser children.
    while True:
        try:
            os.waitpid(-1, 0)
        except ChildProcessError:
            return


def run():
    if os.name != "posix":
        raise RuntimeError("Combined mode requires a POSIX container")
    grace = config.positive_integer("SHUTDOWN_GRACE_SECONDS", 120)
    if grace < 60:
        raise RuntimeError("SHUTDOWN_GRACE_SECONDS must be at least 60")
    if config.boolean("AUTO_MIGRATE", False):
        raise RuntimeError("Combined requires AUTO_MIGRATE=false; run the migration Job")
    if not config.boolean("BACKGROUND_JOBS", True):
        raise RuntimeError("Combined requires BACKGROUND_JOBS=true")
    # Both children inherit exactly the same database and storage environment.
    os.environ.update(RUN_MODE="combined", AUTO_MIGRATE="false", BACKGROUND_JOBS="true")
    os.environ.setdefault("WORKER_PARSER_MEMORY_MB", "256")
    config.check_storage(config.storage_path())
    _subreaper()
    from .worker import HEARTBEAT
    HEARTBEAT.unlink(missing_ok=True)
    STATE.unlink(missing_ok=True)
    shutdown = threading.Event()
    stop_signal = signal.SIGTERM

    def request_stop(signum, _frame):
        nonlocal stop_signal
        if not shutdown.is_set():
            stop_signal = signum
            shutdown.set()

    previous = {sig: signal.signal(sig, request_stop) for sig in (signal.SIGTERM, signal.SIGINT)}
    children = {}
    failed = False
    try:
        commands = {
            "api": api_command() + ["--workers", "1", "--timeout-graceful-shutdown", str(grace - 5)],
            "worker": [sys.executable, "-m", "backend.app.worker"],
        }
        for name, command in commands.items():
            if shutdown.is_set():
                break
            # Inherited stdout/stderr go directly to platform logs. No shell, pipes
            # or unbounded log buffers. Separate groups allow parser cleanup.
            children[name] = subprocess.Popen(command, start_new_session=os.name == "posix")
            logger.info("Started process=%s pid=%s", name, children[name].pid)
        if len(children) == 2 and not shutdown.is_set():
            _write_state(children)
        while not shutdown.is_set():
            for name, child in children.items():
                code = child.poll()
                if code is not None:
                    # Even exit 0 is unexpected for these long-running services.
                    logger.error("Unexpected exit process=%s code=%s", name, code)
                    failed = True
                    shutdown.set()
                    break
            shutdown.wait(0.2)
    finally:
        # Fail readiness immediately, including while a worker finishes its job.
        STATE.unlink(missing_ok=True)
        deadline = time.monotonic() + grace
        for child in children.values():
            if child.poll() is None:
                try:
                    # Signal only the worker, allowing its parser to finish.
                    child.send_signal(stop_signal)
                except ProcessLookupError:
                    pass
        for name, child in children.items():
            try:
                code = child.wait(timeout=max(0, deadline - time.monotonic()))
                if code not in {0, -stop_signal}:
                    failed = True
            except subprocess.TimeoutExpired:
                logger.error("Shutdown deadline exceeded process=%s", name)
                failed = True
        # Kill any remaining groups, including parsers orphaned by a crashed worker.
        for child in children.values():
            _kill_group(child)
        for child in children.values():
            child.wait()
        _reap_orphans()
        HEARTBEAT.unlink(missing_ok=True)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return 1 if failed else 0


def main():
    config.configure_logging()
    try:
        return run()
    except Exception as exc:
        logger.error("Combined stopped error_type=%s", type(exc).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
