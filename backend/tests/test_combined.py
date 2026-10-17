import os
import signal
import sys

import pytest
from fastapi.testclient import TestClient

from backend.app import combined, config, entrypoint, healthcheck, worker
from backend.app.main import create_app


@pytest.mark.parametrize("mode", ["api", "worker", "combined"])
def test_run_modes(monkeypatch, mode):
    monkeypatch.setenv("RUN_MODE", mode)
    assert config.run_mode() == mode


def test_default_mode_and_invalid_mode(monkeypatch):
    monkeypatch.delenv("RUN_MODE", raising=False)
    assert config.run_mode() == "api"
    monkeypatch.setenv("RUN_MODE", "secret-invalid-value")
    with pytest.raises(RuntimeError, match="RUN_MODE") as error:
        config.run_mode()
    assert "secret-invalid-value" not in str(error.value)


@pytest.mark.parametrize("mode,module", [("api", "uvicorn"), ("worker", "backend.app.worker")])
def test_dispatcher_executes_selected_process(monkeypatch, mode, module):
    monkeypatch.setenv("RUN_MODE", mode)
    calls = []
    monkeypatch.setattr(entrypoint.os, "execv", lambda executable, args: calls.append((executable, args)))
    entrypoint.main()
    assert calls[0][0] == sys.executable
    assert calls[0][1][:3] == [sys.executable, "-m", module]


def test_dispatcher_combined(monkeypatch):
    monkeypatch.setenv("RUN_MODE", "combined")
    monkeypatch.setattr(combined, "main", lambda: 17)
    assert entrypoint.main() == 17


def test_combined_readiness_includes_worker(database, tmp_path, monkeypatch):
    monkeypatch.setenv("RUN_MODE", "combined")
    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    monkeypatch.setattr(combined, "check_health", lambda: None)
    with TestClient(create_app(database.path, storage_path=tmp_path / "uploads")) as client:
        assert client.get("/api/ready").status_code == 200
        def stale():
            raise RuntimeError("Worker heartbeat is stale")
        monkeypatch.setattr(combined, "check_health", stale)
        assert client.get("/api/ready").status_code == 503


def test_api_only_readiness_does_not_require_worker(database, monkeypatch):
    monkeypatch.setenv("RUN_MODE", "api")
    def forbidden():
        raise AssertionError("Standalone API must not check a local worker")
    monkeypatch.setattr(combined, "check_health", forbidden)
    with TestClient(create_app(database.path)) as client:
        assert client.get("/api/ready").status_code == 200


def test_worker_probe_has_no_http_dependency(monkeypatch):
    monkeypatch.setenv("RUN_MODE", "worker")
    monkeypatch.setattr(worker, "check_health", lambda: None)
    monkeypatch.setattr(healthcheck.urllib.request, "urlopen", lambda *a, **kw: pytest.fail("HTTP in worker mode"))
    assert healthcheck.main() == 0


def test_probe_failure_does_not_log_secrets(monkeypatch, caplog):
    monkeypatch.setenv("RUN_MODE", "worker")
    def failed():
        raise RuntimeError("private-database-password")
    monkeypatch.setattr(worker, "check_health", failed)
    assert healthcheck.main() == 1
    assert "private-database-password" not in caplog.text


def test_production_storage_requires_mount_and_write_probe(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(config.sys, "platform", "linux")
    monkeypatch.setattr(config.os.path, "ismount", lambda path: False)
    with pytest.raises(RuntimeError, match="mounted volume"):
        config.check_storage(tmp_path)
    monkeypatch.setattr(config.os.path, "ismount", lambda path: True)
    config.check_storage(tmp_path)


@pytest.mark.skipif(os.name != "posix", reason="Linux container supervisor")
@pytest.mark.parametrize("exit_code", [0, 7, -signal.SIGTERM])
def test_unexpected_child_exit_stops_peer_and_reaps(tmp_path, monkeypatch, exit_code):
    monkeypatch.setenv("RUN_MODE", "combined")
    monkeypatch.setenv("WORKER_PARSER_MEMORY_MB", "256")
    monkeypatch.setenv("STORAGE_PATH", str(tmp_path))
    monkeypatch.setenv("AUTO_MIGRATE", "false")
    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    monkeypatch.setattr(combined, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(worker, "HEARTBEAT", tmp_path / "heartbeat")
    monkeypatch.setattr(combined, "_subreaper", lambda: None)
    monkeypatch.setattr(combined, "_reap_orphans", lambda: None)
    killed = []
    monkeypatch.setattr(combined, "_kill_group", lambda child: killed.append(child))
    children = []

    class Child:
        def __init__(self, command, **kwargs):
            self.pid = 99990 + len(children)
            self.code = exit_code if not children else None
            self.signals = []
            self.waited = False
            children.append(self)

        def poll(self):
            return self.code

        def send_signal(self, signum):
            self.signals.append(signum)
            self.code = 0

        def wait(self, timeout=None):
            self.waited = True
            return self.code

    monkeypatch.setattr(combined.subprocess, "Popen", Child)
    assert combined.run() == 1
    assert children[1].signals == [signal.SIGTERM]
    assert all(child.waited for child in children)
    assert killed == children
    assert not combined.STATE.exists()


@pytest.fixture
def posix_supervisor(tmp_path, monkeypatch):
    if os.name != "posix":
        pytest.skip("Linux container supervisor")
    monkeypatch.setenv("RUN_MODE", "combined")
    monkeypatch.setenv("WORKER_PARSER_MEMORY_MB", "256")
    monkeypatch.setenv("STORAGE_PATH", str(tmp_path))
    monkeypatch.setenv("AUTO_MIGRATE", "false")
    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    monkeypatch.setattr(combined, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(worker, "HEARTBEAT", tmp_path / "heartbeat")
    return tmp_path


def test_crashed_parent_parser_group_is_killed_and_reaped(posix_supervisor, monkeypatch):
    pid_file = posix_supervisor / "parser.pid"
    popen = combined.subprocess.Popen
    children = []

    def spawn(command, **kwargs):
        if not children:
            script = ("import subprocess,sys,time; from pathlib import Path; "
                      "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
                      f"Path({str(pid_file)!r}).write_text(str(child.pid)); time.sleep(0.2); sys.exit(7)")
        else:
            script = "import time; time.sleep(60)"
        child = popen([sys.executable, "-c", script], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(combined.subprocess, "Popen", spawn)
    assert combined.run() == 1
    assert all(child.returncode is not None for child in children)
    with pytest.raises(ProcessLookupError):
        os.kill(int(pid_file.read_text()), 0)


def test_second_spawn_failure_cleans_up_first_child(posix_supervisor, monkeypatch, caplog):
    popen = combined.subprocess.Popen
    children = []

    def spawn(command, **kwargs):
        if children:
            raise RuntimeError("private-spawn-error")
        child = popen([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(combined.subprocess, "Popen", spawn)
    assert combined.main() == 1
    assert children[0].poll() is not None
    assert not combined.STATE.exists()
    assert "private-spawn-error" not in caplog.text


@pytest.mark.parametrize("key,value", [("AUTO_MIGRATE", "true"), ("BACKGROUND_JOBS", "false"),
                                       ("SHUTDOWN_GRACE_SECONDS", "59")])
def test_combined_rejects_unsafe_startup(posix_supervisor, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match=key.split("_")[0]):
        combined.run()
