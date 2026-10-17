from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app.jobs import JobQueue
from backend.app.main import create_app
from backend.app.worker import process_one

TEXT = "Hãy phân tích vai trò của dẫn chứng trong bài nghị luận."


@pytest.fixture
def queue(database, tmp_path):
    return JobQueue(database, tmp_path / "uploads")


def test_background_upload_survives_api_restart(database, tmp_path, monkeypatch):
    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    storage = tmp_path / "uploads"
    with TestClient(create_app(database.path, storage_path=storage)) as api:
        assert api.get("/api/ready").json()["background_jobs"] is True
        response = api.post("/api/uploads/extract", files={"file": ("de-bai.txt", TEXT.encode(), "text/plain")})
        assert response.status_code == 202
        document_id = response.json()["document_id"]
        assert api.get(f"/api/documents/{document_id}").json()["status"] == "uploaded"

    # A new queue and API instance recover the persisted job and original file.
    assert process_one(JobQueue(database, storage))
    with TestClient(create_app(database.path, storage_path=storage)) as api:
        result = api.get(f"/api/documents/{document_id}").json()
        assert result["status"] == "needs_review"
        assert result["text"] == TEXT
        assert result["structure"]["parts"][0]["questions"][0]["label"] == "Nội dung chưa tách được"
        assert "storage_key" not in result
        assert api.get("/api/documents/missing").status_code == 404


def test_only_one_worker_claims_a_job(queue):
    queue.submit("de.txt", TEXT.encode())
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(lambda _: queue.claim(), range(2)))
    assert sum(claim is not None for claim in claims) == 1


def test_expired_lease_can_be_reclaimed_without_stale_overwrite(queue):
    document = queue.submit("de.txt", TEXT.encode())
    first = queue.claim()
    with queue.db.connect(write=True) as conn:
        queue.db.execute(conn, "UPDATE jobs SET lease_until=0 WHERE id=?", (first["id"],))
    second = queue.claim()
    assert second["attempts"] == 2
    assert first["lease_token"] != second["lease_token"]
    assert not queue.renew(first)
    assert not queue.finish(first, text="stale")
    assert queue.renew(second)
    assert queue.finish(second, text=TEXT)
    assert queue.document(document["document_id"])["text"] == TEXT


def test_transient_file_failure_retries_without_losing_job(queue, monkeypatch):
    document = queue.submit("de.txt", TEXT.encode())
    read_file = queue.read_file
    monkeypatch.setattr(queue, "read_file", lambda _: (_ for _ in ()).throw(OSError("test failure")))
    assert process_one(queue)
    result = queue.document(document["document_id"])
    assert result["status"] == "uploaded"
    assert result["attempts"] == 1
    with queue.db.connect(write=True) as conn:
        queue.db.execute(conn, "UPDATE jobs SET available_at=0 WHERE id=?", (document["job_id"],))
    monkeypatch.setattr(queue, "read_file", read_file)
    assert process_one(queue)
    assert queue.document(document["document_id"])["status"] == "needs_review"


def test_exhausted_crashed_job_is_marked_failed(queue):
    document = queue.submit("de.txt", TEXT.encode())
    queue.claim()
    with queue.db.connect(write=True) as conn:
        queue.db.execute(conn, "UPDATE jobs SET attempts=max_attempts, lease_until=0 WHERE id=?", (document["job_id"],))
    assert queue.claim() is None
    assert queue.document(document["document_id"])["status"] == "failed"


def test_invalid_pdf_is_a_terminal_failure(queue):
    document = queue.submit("broken.pdf", b"%PDF-not really a pdf")
    assert process_one(queue)
    result = queue.document(document["document_id"])
    assert result["status"] == "failed"
    assert result["text"] is None
    assert result["attempts"] == 1


def test_migration_is_idempotent_and_keeps_data(queue):
    document = queue.submit("de.txt", TEXT.encode())
    queue.db.initialize()
    queue.db.initialize()
    assert queue.document(document["document_id"])["status"] == "uploaded"
    assert process_one(queue)


def test_api_readiness_fails_when_database_unavailable(database, monkeypatch):
    with TestClient(create_app(database.path)) as api:
        def unavailable():
            raise RuntimeError("database connection failed")
        monkeypatch.setattr(api.app.state.db, "check_ready", unavailable)
        assert api.get("/api/health").status_code == 200
        assert api.get("/api/ready").status_code == 503
