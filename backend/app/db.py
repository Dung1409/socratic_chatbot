import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

from . import config


def encode(value):
    return json.dumps(value, ensure_ascii=False)


class Database:
    """PostgreSQL in Compose; SQLite remains available for local development."""

    def __init__(self, path: str):
        self.path = path
        self.postgres = path.startswith(("postgresql://", "postgres://"))

    @classmethod
    def from_env(cls):
        url = config.validate_database_url()
        if url:
            return cls(url)
        if os.getenv("PGHOST"):
            user = quote(os.getenv("PGUSER", "socratic"), safe="")
            password = quote(os.getenv("PGPASSWORD", ""), safe="")
            name = quote(os.getenv("PGDATABASE", "socratic"), safe="")
            return cls(f"postgresql://{user}:{password}@{os.environ['PGHOST']}:{os.getenv('PGPORT', '5432')}/{name}")
        return cls(os.getenv(
            "DATABASE_PATH", str(Path(__file__).resolve().parents[1] / "data/socratic.db")))

    @contextmanager
    def connect(self, write=False, serialize=True):
        if self.postgres:
            import psycopg
            from psycopg.conninfo import conninfo_to_dict
            from psycopg.rows import dict_row
            options = conninfo_to_dict(self.path).get("options", os.getenv("PGOPTIONS", ""))
            conn = psycopg.connect(
                self.path, row_factory=dict_row, connect_timeout=5,
                options=f"{options} -c statement_timeout={config.positive_integer('DB_STATEMENT_TIMEOUT_MS', 30000)} "
                        f"-c lock_timeout={config.positive_integer('DB_LOCK_TIMEOUT_MS', 5000)}",
            )
        else:
            conn = sqlite3.connect(self.path, timeout=30)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                if self.postgres and serialize:
                    # Preserve atomic read-modify-write operations in the existing
                    # demo API. Queue claims use their own row locks instead.
                    conn.execute("SELECT pg_advisory_xact_lock(7310521)")
                elif not self.postgres:
                    conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self):
        if not self.postgres:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect(write=True) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)")
            dialect = "postgres" if self.postgres else "sqlite"
            for migration in sorted((Path(__file__).parent / "migrations" / dialect).glob("*.sql")):
                if self.execute(conn, "SELECT version FROM schema_migrations WHERE version=?", (migration.stem,)).fetchone():
                    continue
                for statement in migration.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        conn.execute(statement)
                self.execute(conn, "INSERT INTO schema_migrations (version) VALUES (?)", (migration.stem,))

    def check_ready(self):
        with self.connect() as conn:
            dialect = "postgres" if self.postgres else "sqlite"
            required = {path.stem for path in (Path(__file__).parent / "migrations" / dialect).glob("*.sql")}
            applied = {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}
            if not required.issubset(applied):
                raise RuntimeError("Database migrations are required")
            conn.execute("SELECT id FROM jobs LIMIT 1")

    @staticmethod
    def execute(conn, query, params=()):
        if not isinstance(conn, sqlite3.Connection):
            query = query.replace("?", "%s")
        return conn.execute(query, params)

    @staticmethod
    def get(conn, collection, identifier, owner_id=None):
        query = "SELECT body FROM documents WHERE collection=? AND id=?"
        params = (collection, identifier)
        if owner_id is not None:
            query += " AND owner_id=?"
            params += (owner_id,)
        row = Database.execute(conn, query, params).fetchone()
        return json.loads(row["body"]) if row else None

    @staticmethod
    def all(conn, collection, owner_id=None):
        query = "SELECT body FROM documents WHERE collection=?"
        params = (collection,)
        if owner_id is not None:
            query += " AND owner_id=?"
            params += (owner_id,)
        return [json.loads(row["body"]) for row in Database.execute(conn, query + " ORDER BY rowid DESC", params)]

    @staticmethod
    def put(conn, collection, identifier, value, owner_id=None):
        Database.execute(conn, """INSERT INTO documents (collection, id, body, owner_id) VALUES (?, ?, ?, ?)
            ON CONFLICT(collection, id) DO UPDATE SET body=excluded.body
            WHERE documents.owner_id=excluded.owner_id
               OR (documents.owner_id IS NULL AND excluded.owner_id IS NULL)""",
            (collection, identifier, encode(value), owner_id))
