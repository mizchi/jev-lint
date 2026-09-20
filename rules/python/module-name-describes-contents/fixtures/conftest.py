import sqlite3

import pytest

from session_store import SessionStore


@pytest.fixture
def conn():
    connection = sqlite3.connect(":memory:")
    yield connection
    connection.close()


@pytest.fixture
def store():
    return SessionStore(ttl_seconds=60)
