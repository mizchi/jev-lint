from __future__ import annotations

import logging
import os
import signal
import sqlite3
from collections import defaultdict
from pathlib import Path

logger = logging.getLogger(__name__)

_handlers: list[tuple[str, object]] = []
_hooks: dict[str, list] = defaultdict(list)


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    conn.commit()


def setup_db(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    conn.execute("CREATE INDEX IF NOT EXISTS jobs_state ON jobs (state)")
    conn.commit()


def register_handler(name: str, fn) -> None:
    _handlers.append((name, fn))


def install_hook(name: str, fn) -> None:
    if fn in _hooks[name]:
        return
    _hooks[name].append(fn)


def setup_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(logging.StreamHandler())


def setup_signal_handlers(on_stop) -> None:
    signal.signal(signal.SIGTERM, on_stop)
    signal.signal(signal.SIGINT, on_stop)


def upsert_user(conn: sqlite3.Connection, user_id: str, email: str) -> None:
    conn.execute("INSERT INTO users (id, email) VALUES (?, ?)", (user_id, email))
    conn.commit()


def upsert_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def ensure_dir(path: Path) -> Path:
    os.mkdir(path)
    return path


def ensure_cache_dir(path: Path) -> Path:
    os.makedirs(path, exist_ok=True)
    return path


def ensure_int(value: str | int) -> int:
    if isinstance(value, int):
        return value
    return int(value.strip())


class Service:
    def __init__(self) -> None:
        self.started = False
        self.plugins: dict[str, object] = {}
        self.listeners: list = []

    def ensure_started(self) -> None:
        if self.started:
            return
        self.started = True
        logger.info("service started")

    def register_plugin(self, plugin) -> None:
        logger.debug("registering %s", plugin.name)
        self.plugins[plugin.name] = plugin

    def register_listener(self, listener) -> None:
        self.listeners.append(listener)

    def setup_workdir(self, base: Path) -> Path:
        workdir = base / "work"
        workdir.mkdir(parents=True, exist_ok=True)
        (workdir / "lock").write_text(str(os.getpid()))
        return workdir


def ensure_migrated(conn: sqlite3.Connection, version: int) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    if current >= version:
        return
    conn.execute("ALTER TABLE jobs ADD COLUMN retries INTEGER DEFAULT 0")
    conn.execute(f"PRAGMA user_version = {version}")
    conn.commit()
