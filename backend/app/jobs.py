import hashlib
import json
import time
from pathlib import Path
from uuid import uuid4

from .db import Database
from .extraction import MAX_FILE_BYTES, validate_upload
from .structure import structure_text


class JobQueue:
    def __init__(self, db: Database, storage_path: Path, lease_seconds: float = 120):
        self.db = db
        self.storage_path = storage_path.resolve()
        self.lease_seconds = lease_seconds

    def file_path(self, key: str) -> Path:
        path = (self.storage_path / key).resolve()
        if not path.is_relative_to(self.storage_path):
            raise ValueError("Invalid storage key")
        return path

    def submit(self, filename: str, data: bytes):
        validate_upload(filename, data)
        document_id, job_id = str(uuid4()), str(uuid4())
        storage_key = f"{document_id}{Path(filename).suffix.lower()}"
        self.storage_path.mkdir(parents=True, exist_ok=True)
        path = self.file_path(storage_key)
        path.write_bytes(data)
        timestamp = time.time()
        try:
            with self.db.connect(write=True, serialize=False) as conn:
                self.db.execute(conn, """
                    INSERT INTO uploaded_documents
                    (id, filename, storage_key, sha256, status, title, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?)
                """, (document_id, filename, storage_key, hashlib.sha256(data).hexdigest(),
                      Path(filename).stem, timestamp, timestamp))
                self.db.execute(conn, """
                    INSERT INTO jobs (id, document_id, type, status, available_at, created_at, updated_at)
                    VALUES (?, ?, 'extract_document', 'queued', ?, ?, ?)
                """, (job_id, document_id, timestamp, timestamp, timestamp))
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {"document_id": document_id, "job_id": job_id, "status": "uploaded"}

    def document(self, document_id: str):
        with self.db.connect() as conn:
            row = self.db.execute(conn, """
                SELECT d.id AS document_id, j.id AS job_id, d.filename, d.title,
                       d.status, d.extracted_text AS text, d.extracted_pages,
                       d.extraction_warnings, d.error, j.attempts
                FROM uploaded_documents d JOIN jobs j ON j.document_id=d.id WHERE d.id=?
            """, (document_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["pages"] = json.loads(result.pop("extracted_pages") or "[]")
        result["extraction_warnings"] = json.loads(result["extraction_warnings"] or "[]")
        result["structure"] = structure_text(result["text"], result["pages"]) if result["text"] else None
        return result

    def claim(self):
        timestamp = time.time()
        with self.db.connect(write=True, serialize=False) as conn:
            # A worker killed on its final attempt must not leave a job stuck.
            self.db.execute(conn, """
                UPDATE uploaded_documents SET status='failed', error=?, updated_at=?
                WHERE id IN (SELECT document_id FROM jobs WHERE status='processing'
                    AND lease_until<=? AND attempts>=max_attempts)
            """, ("Tác vụ bị gián đoạn và đã hết số lần thử.", timestamp, timestamp))
            self.db.execute(conn, """
                UPDATE jobs SET status='failed', lease_token=NULL, lease_until=NULL,
                    last_error=?, updated_at=?
                WHERE status='processing' AND lease_until<=? AND attempts>=max_attempts
            """, ("Worker lease expired", timestamp, timestamp))
            query = """
                SELECT j.*, d.storage_key, d.filename FROM jobs j
                JOIN uploaded_documents d ON d.id=j.document_id
                WHERE j.attempts<j.max_attempts AND
                    ((j.status='queued' AND j.available_at<=?) OR
                     (j.status='processing' AND j.lease_until<=?))
                ORDER BY j.created_at LIMIT 1
            """
            if self.db.postgres:
                query += " FOR UPDATE OF j SKIP LOCKED"
            row = self.db.execute(conn, query, (timestamp, timestamp)).fetchone()
            if row is None:
                return None
            job = dict(row)
            job["lease_token"] = str(uuid4())
            job["attempts"] += 1
            self.db.execute(conn, """
                UPDATE jobs SET status='processing', attempts=attempts+1,
                    lease_until=?, lease_token=?, updated_at=? WHERE id=?
            """, (timestamp + self.lease_seconds, job["lease_token"], timestamp, job["id"]))
            self.db.execute(conn, "UPDATE uploaded_documents SET status='processing', updated_at=? WHERE id=?",
                            (timestamp, job["document_id"]))
            return job

    def renew(self, job):
        timestamp = time.time()
        with self.db.connect(write=True, serialize=False) as conn:
            cursor = self.db.execute(conn, """
                UPDATE jobs SET lease_until=?, updated_at=?
                WHERE id=? AND lease_token=? AND status='processing' AND lease_until>?
            """, (timestamp + self.lease_seconds, timestamp, job["id"], job["lease_token"], timestamp))
            return cursor.rowcount == 1

    def finish(self, job, text: str | None = None, error: str | None = None, retryable=False,
               pages: list | None = None, warnings: list | None = None):
        timestamp = time.time()
        retry = error is not None and retryable and job["attempts"] < job["max_attempts"]
        status = "queued" if retry else "failed" if error is not None else "completed"
        with self.db.connect(write=True, serialize=False) as conn:
            cursor = self.db.execute(conn, """
                UPDATE jobs SET status=?, last_error=?, lease_token=NULL, lease_until=NULL,
                    available_at=?, updated_at=?
                WHERE id=? AND lease_token=? AND status='processing' AND lease_until>?
            """, (status, error, timestamp + 2 ** job["attempts"], timestamp,
                  job["id"], job["lease_token"], timestamp))
            if cursor.rowcount != 1:
                return False  # A reclaimed lease cannot overwrite a newer result.
            document_status = "uploaded" if retry else "failed" if error is not None else "needs_review"
            self.db.execute(conn, """
                UPDATE uploaded_documents SET status=?, extracted_text=?, extracted_pages=?,
                    extraction_warnings=?, error=?, updated_at=? WHERE id=?
            """, (document_status, text, json.dumps(pages or [], ensure_ascii=False),
                  json.dumps(warnings or [], ensure_ascii=False), None if retry else error,
                  timestamp, job["document_id"]))
            return True

    def read_file(self, job):
        with self.file_path(job["storage_key"]).open("rb") as file:
            return file.read(MAX_FILE_BYTES + 1)
