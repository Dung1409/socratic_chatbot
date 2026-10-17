"""Destructive fault tests ONLY against containers/volumes created by this script.

Build first: docker build -f backend/Dockerfile -t socratic-backend:combined-test backend
Run: python scripts/test_combined_container.py
Never reads .env or accepts a database URL. All data is disposable.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from uuid import uuid4

import httpx
import psycopg


def docker(*args, check=True, timeout=180):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        # Only temporary test credentials are ever passed to Docker here.
        raise RuntimeError(f"docker {args[0]} failed: {result.stderr}")
    return result


def eventually(predicate, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (httpx.HTTPError, psycopg.Error):
            pass
        time.sleep(0.2)
    raise AssertionError("Timed out waiting for test condition")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="socratic-backend:combined-test")
    parser.add_argument("--skip-suite", action="store_true", help="Skip the existing suite on disposable PostgreSQL")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    prefix = f"socratic-test-{uuid4().hex[:10]}"
    network, volume, pg, app = (f"{prefix}-{suffix}" for suffix in ("net", "files", "pg", "app"))
    containers = []
    db_url = f"postgresql://socratic:test-only-password@{pg}:5432/socratic"
    jwt_secret = secrets.token_urlsafe(48)
    common = ["-e", "APP_ENV=production", "-e", f"DATABASE_URL={db_url}", "-e", "AUTO_MIGRATE=false"]
    runtime = [*common, "-e", "RUN_MODE=combined", "-e", "BACKGROUND_JOBS=true",
               "-e", "STORAGE_PATH=/app/storage", "-e", "SHUTDOWN_GRACE_SECONDS=120",
               "-e", "WORKER_PARSER_MEMORY_MB=256", "-e", "TUTOR_MODE=template",
               "-e", f"JWT_SECRET={jwt_secret}",
               "-e", "AUTH_COOKIE_SECURE=true", "-e", "AUTH_ALLOWED_ORIGINS=https://study.example.com",
               "-e", "CORS_ORIGINS=https://study.example.com", "-e", "TRUST_PROXY_HEADERS=false",
               "-e", "PUBLIC_API_ORIGIN=https://study.example.com"]

    def state(name=app):
        return json.loads(docker("inspect", "--format", "{{json .State}}", name).stdout)

    def exec_python(script, check=True):
        return docker("exec", app, "python", "-c", script, check=check)

    def stopped(error=False):
        result = eventually(lambda: (s if not (s := state())["Running"] else None), timeout=150)
        assert (result["ExitCode"] != 0) if error else (result["ExitCode"] == 0), result

    try:
        docker("network", "create", network)
        docker("volume", "create", volume)
        containers.append(pg)
        docker("run", "-d", "--name", pg, "--network", network,
               "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=socratic",
               "-e", "POSTGRES_PASSWORD=test-only-password", "-e", "POSTGRES_DB=socratic", "postgres:16-alpine")
        eventually(lambda: docker("exec", pg, "pg_isready", "-U", "socratic", check=False).returncode == 0)
        pg_port = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", pg).stdout)["5432/tcp"][0]["HostPort"]
        host_db = f"postgresql://socratic:test-only-password@127.0.0.1:{pg_port}/socratic"
        # New volume ownership setup, performed by a one-shot helper, never the app.
        docker("run", "--rm", "--user", "0:0", "--mount", f"type=volume,src={volume},dst=/app/storage",
               args.image, "python", "-c", "import os; os.chown('/app/storage', 10001, 10001)")
        # RUN_MODE=combined must not intercept the migration command or require a volume.
        for _ in range(2):
            docker("run", "--rm", "--network", network, *common, "-e", "RUN_MODE=combined",
                   args.image, "python", "-m", "backend.app.migrate")
        print("PASS: independent/idempotent migration without storage or API secrets", flush=True)

        for mount in ([], ["--mount", f"type=volume,src={volume},dst=/app/storage,readonly"]):
            result = docker("run", "--rm", "--network", network, *runtime, *mount, args.image, check=False)
            assert result.returncode != 0, "Unusable storage must prevent startup"
        print("PASS: missing mount and read-only storage rejected", flush=True)

        containers.append(app)
        docker("run", "-d", "--name", app, "--network", network, "--memory", "1g", "--cpus", "1",
               "--stop-timeout", "150", "-p", "127.0.0.1::8000",
               "--mount", f"type=volume,src={volume},dst=/app/storage", *runtime, args.image)
        api_port = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", app).stdout)["8000/tcp"][0]["HostPort"]
        with httpx.Client(base_url=f"http://127.0.0.1:{api_port}", timeout=10) as client:
            def restart():
                docker("start", app)
                # Docker may allocate a different host port when restarting a
                # container originally published with an ephemeral host port.
                ports = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", app).stdout)
                client.base_url = f"http://127.0.0.1:{ports['8000/tcp'][0]['HostPort']}"

            def ready():
                return client.get("/api/ready").status_code == 200

            def document(identifier):
                response = client.get(f"/api/documents/{identifier}")
                response.raise_for_status()
                return response.json()

            def upload():
                response = client.post("/api/documents", files={"file": ("shared.txt", b"A shared file parsed by the worker in the same container.", "text/plain")})
                assert response.status_code == 202, response.text
                return response.json()

            eventually(ready)
            assert exec_python("import os; assert os.getuid()==10001 and os.getgid()==10001").returncode == 0
            processes = json.loads(exec_python("from backend.app.combined import STATE; print(STATE.read_text())").stdout)
            assert set(processes) == {"supervisor", "api", "worker"}
            assert processes["supervisor"] == 1
            assert len(set(processes.values())) == 3
            exec_python(f"from pathlib import Path; cmd=Path('/proc/{processes['api']}/cmdline').read_bytes().split(b'\\0'); assert b'--no-proxy-headers' in cmd and b'--proxy-headers' not in cmd")
            assert docker("exec", app, "python", "-m", "backend.app.healthcheck").returncode == 0
            response = client.post("/api/auth/register", json={"email": "container@example.com", "password": "Test-only password 123", "display_name": "Container test"})
            assert response.status_code == 201, response.text
            client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
            # Production cookies are Secure; explicitly forward them over local test HTTP.
            client.headers["Cookie"] = "; ".join(f"{cookie.name}={cookie.value}" for cookie in client.cookies.jar)
            uploaded = upload()
            identifier = uploaded["document_id"]
            eventually(lambda: document(identifier)["status"] == "needs_review")
            assert document(identifier)["text"] == "A shared file parsed by the worker in the same container."
            exec_python("from pathlib import Path; assert any(Path('/app/storage').glob('*.txt'))")
            print("PASS: combined PID 1, UID/GID 10001, API upload -> shared volume -> worker on PostgreSQL (1 GiB limit)", flush=True)

            # A running but stalled worker must also fail HTTP readiness and CMD probe.
            exec_python("import json,os,signal,time; from backend.app.combined import STATE; from backend.app.worker import HEARTBEAT; os.kill(json.loads(STATE.read_text())['worker'], signal.SIGSTOP); os.utime(HEARTBEAT, (time.time()-61, time.time()-61))")
            assert client.get("/api/ready").status_code == 503
            assert docker("exec", app, "python", "-m", "backend.app.healthcheck", check=False).returncode != 0
            exec_python("import json,os,signal; from backend.app.combined import STATE; os.kill(json.loads(STATE.read_text())['worker'], signal.SIGCONT)")
            eventually(ready)
            print("PASS: stale worker heartbeat fails readiness and container probe", flush=True)

            for role in ("api", "worker"):
                exec_python(f"import json,os,signal; from backend.app.combined import STATE; os.kill(json.loads(STATE.read_text())[{role!r}], signal.SIGKILL)")
                stopped(error=True)
                restart()
                eventually(ready)
                assert document(identifier)["status"] == "needs_review"
                print(f"PASS: {role} crash -> container nonzero -> restart preserves file/job", flush=True)

            # Hold completion briefly in this disposable database, so SIGTERM is
            # delivered while the worker has an active job. No application changes.
            with psycopg.connect(host_db, autocommit=True) as conn:
                conn.execute("""CREATE FUNCTION test_slow_finish() RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN PERFORM pg_sleep(4); RETURN NEW; END $$""")
                conn.execute("""CREATE TRIGGER test_slow_finish BEFORE UPDATE ON jobs
                    FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION test_slow_finish()""")
            active = upload()
            def finishing():
                with psycopg.connect(host_db) as conn:
                    return conn.execute("SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep'").fetchone()
            eventually(finishing)
            docker("kill", "--signal", "SIGTERM", app)
            stopped()
            with psycopg.connect(host_db, autocommit=True) as conn:
                assert conn.execute("SELECT status FROM jobs WHERE id=%s", (active["job_id"],)).fetchone()[0] == "completed"
                conn.execute("DROP TRIGGER test_slow_finish ON jobs")
                conn.execute("DROP FUNCTION test_slow_finish()")
            restart()
            eventually(ready)
            assert document(active["document_id"])["status"] == "needs_review"
            print("PASS: SIGTERM during active job drains job, exits 0, restart keeps result", flush=True)
            docker("kill", "--signal", "SIGINT", app)
            stopped()
            print("PASS: SIGINT shutdown", flush=True)

        # Standalone modes remain usable without starting the peer process.
        for mode in ("worker", "api"):
            name = f"{prefix}-{mode}"
            containers.append(name)
            docker("run", "-d", "--name", name, "--network", network, *runtime, "-e", f"RUN_MODE={mode}",
                   "--mount", f"type=volume,src={volume},dst=/app/storage", args.image)
            eventually(lambda: docker("exec", name, "python", "-m", "backend.app.healthcheck", check=False).returncode == 0)
            docker("stop", "--time", "150", name)
            assert state(name)["ExitCode"] in (0, 130, 143)
        print("PASS: independent RUN_MODE=api and RUN_MODE=worker", flush=True)

        logs = docker("logs", app).stdout + docker("logs", app).stderr
        for secret in ("test-only-password", jwt_secret, "Test-only password 123"):
            assert secret not in logs
        print("PASS: application logs contain no test secrets", flush=True)
        if not args.skip_suite:
            env = {**os.environ, "APP_ENV": "test", "TEST_DATABASE_URL": host_db, "DATABASE_URL": "",
                   "RUN_MODE": "api", "AUTO_MIGRATE": "true", "BACKGROUND_JOBS": "false"}
            result = subprocess.run([sys.executable, "-m", "pytest", "backend/tests", "-q"], cwd=root, env=env)
            assert result.returncode == 0, "PostgreSQL suite failed"
            print("PASS: backend suite with disposable PostgreSQL schemas", flush=True)
    except Exception:
        if app in containers:
            print(docker("logs", "--tail", "60", app, check=False).stderr, file=sys.stderr)
        raise
    finally:
        for name in reversed(containers):
            docker("rm", "-f", "-v", name, check=False)
        docker("volume", "rm", volume, check=False)
        docker("network", "rm", network, check=False)
        print("Disposable test resources cleaned up", flush=True)


if __name__ == "__main__":
    main()
