import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def encode(value):
    return json.dumps(value, ensure_ascii=False)


class Database:
    """Local persistence. Each mutation is committed atomically, including session turns."""

    def __init__(self, path: str):
        self.path = path

    @contextmanager
    def connect(self, write=False):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            if write:
                conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        seed = json.loads(Path(__file__).with_name("seed.json").read_text(encoding="utf-8"))
        with self.connect(write=True) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS documents (collection TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(collection, id))")
            for a in reversed(seed["assignments"]):
                a.update(status="Chưa bắt đầu", progress=0)
                conn.execute("INSERT OR IGNORE INTO documents VALUES (?, ?, ?)", ("assignments", a["id"], encode(a)))
            conn.execute("INSERT OR IGNORE INTO documents VALUES (?, ?, ?)", ("settings", "rubric", encode({"version": 1, "criteria": seed["rubric"]})))

    @staticmethod
    def get(conn, collection, identifier):
        row = conn.execute("SELECT body FROM documents WHERE collection=? AND id=?", (collection, identifier)).fetchone()
        return json.loads(row["body"]) if row else None

    @staticmethod
    def all(conn, collection):
        return [json.loads(row["body"]) for row in conn.execute("SELECT body FROM documents WHERE collection=? ORDER BY rowid DESC", (collection,))]

    @staticmethod
    def put(conn, collection, identifier, value):
        conn.execute("INSERT INTO documents VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET body=excluded.body", (collection, identifier, encode(value)))
