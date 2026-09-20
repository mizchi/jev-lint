import os
import time
from pathlib import Path

import requests

BASE_URL = os.environ.get("API_BASE", "https://api.example.test")
retries = 3
_session = requests.Session()


def fetch_user(uid: str) -> dict:
    resp = _session.get(f"{BASE_URL}/users/{uid}", timeout=10)
    resp.raise_for_status()
    return resp.json()


def is_admin_user(uid: str) -> bool:
    users = fetch_user(uid)
    is_admin = users.get("role")
    return is_admin == "admin"


def domain_of(email: str) -> str:
    username = email.split("@")[1]
    return username.lower()


def read_endpoints(path: Path) -> list[str]:
    config_path = path.read_text().splitlines()
    seen: set[str] = set()
    pending: list[str] = []
    for line in config_path:
        url = line.strip()
        if url and url not in seen:
            seen.add(url)
            pending.append(url)
    return pending


def healthy_count(urls: list[str]) -> int:
    count = [u for u in urls if _session.get(u, timeout=5).ok]
    return len(count)


def latest_line(log: Path) -> str:
    lines = log.read_text().splitlines()
    first = lines[-1]
    return first


def wait_for(url: str) -> bool:
    delay = 0.5
    i = 0
    while i < retries:
        resp = _session.get(url, timeout=5)
        if resp.ok:
            return True
        time.sleep(delay)
        delay *= 2
        i += 1
    return False


def resolve_port() -> int:
    raw = os.environ.get("PORT")
    port = int(raw or 8080)
    return port


def encode_chunks(chunks: list[bytes]) -> bytes:
    buf = bytearray()
    for chunk in chunks:
        buf.extend(chunk)
    return bytes(buf)
