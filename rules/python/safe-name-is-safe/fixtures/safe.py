from __future__ import annotations

import json
import logging
import os
import socket
import sqlite3
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_CONFIG = {"workers": 4, "port": 8080}


def safe_load_json(path: Path) -> dict | None:
    text = path.read_text()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def safe_json_loads(raw: str) -> dict | None:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("bad json: %s", exc)
        return None


def safe_int(raw: str | None, default: int = 0) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def try_parse_int(raw: str) -> int | None:
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"not an integer: {raw!r}") from exc


def try_parse_date(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return None


def get_user_or_none(conn: sqlite3.Connection, user_id: int) -> tuple | None:
    row = conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise KeyError(user_id)
    return row


def safe_divide(a: float, b: float) -> float | None:
    if b == 0:
        raise ZeroDivisionError("division by zero")
    return a / b


def port_or_default(raw: str | None) -> int:
    return int(raw) if raw else DEFAULT_CONFIG["port"]


def config_or_default(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_CONFIG)


def try_connect(host: str, port: int) -> socket.socket | None:
    try:
        return socket.create_connection((host, port), timeout=5)
    except OSError as exc:
        raise ConnectionError(f"cannot reach {host}:{port}") from exc


def try_lock(path: Path) -> bool:
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except OSError:
        return False
    os.close(fd)
    return True


def safe_get(data: dict, *keys: str):
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def safe_remove(path: Path) -> bool:
    try:
        os.remove(path)
    except OSError:
        return False
    return True


def try_get_header(headers: dict[str, str], name: str) -> str | None:
    if not isinstance(name, str):
        raise TypeError("header name must be a str")
    return headers.get(name.lower())


def first_or_default(items, default=None):
    return next(iter(items), default)
