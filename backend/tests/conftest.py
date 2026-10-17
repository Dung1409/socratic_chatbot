import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import pytest

from backend.app.db import Database


@pytest.fixture
def database(tmp_path):
    """Run the same behavior tests on SQLite or a disposable PostgreSQL schema."""
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        db = Database(str(tmp_path / "test.db"))
        db.initialize()
        yield db
        return

    import psycopg
    from psycopg import sql

    schema = f"test_{uuid4().hex}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query))
    params["options"] = f"-csearch_path={schema}"
    db = Database(urlunsplit(parts._replace(query=urlencode(params))))
    try:
        db.initialize()
        yield db
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
