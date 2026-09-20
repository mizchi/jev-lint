from __future__ import annotations

import logging
import sqlite3
import sys
import time
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)


@dataclass
class Job:
    id: str
    url: str
    attempts: int = 0


class Cache:
    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}
        self.log = logging.getLogger("cache")

    def get(self, key: str) -> bytes | None:
        value = self._data.get(key)
        if value is None:
            self.log.error("cache miss for %s", key)
            return None
        self.log.debug("cache hit for %s", key)
        return value

    def put(self, key: str, value: bytes) -> None:
        self._data[key] = value


def connect(dsn: str) -> sqlite3.Connection:
    try:
        return sqlite3.connect(dsn)
    except sqlite3.Error as exc:
        logger.info("failed to connect to %s: %s", dsn, exc)
        raise


def fetch(job: Job, session: requests.Session) -> bytes | None:
    for attempt in range(3):
        try:
            resp = session.get(job.url, timeout=10)
            resp.raise_for_status()
            return resp.content
        except requests.ConnectionError as exc:
            logger.warning("attempt %d for %s failed, retrying: %s", attempt, job.id, exc)
            time.sleep(2**attempt)
    logger.debug("giving up on %s after 3 attempts; result discarded", job.id)
    return None


def charge(user: str, amount_cents: int, balance_cents: int) -> str:
    if amount_cents > balance_cents:
        logger.debug("payment declined for %s: insufficient balance", user)
        return "declined"
    logger.info("charged %s %d cents", user, amount_cents)
    return "charged"


def login(user: str, password: str, expected: str) -> bool:
    if password != expected:
        logger.info("login refused for %s", user)
        return False
    return True


def process(jobs: list[Job], session: requests.Session, cache: Cache) -> int:
    done = 0
    started = time.monotonic()
    for i, job in enumerate(jobs):
        logger.debug("processing job %d/%d (%s)", i + 1, len(jobs), job.id)
        cached = cache.get(job.id)
        if cached is not None:
            done += 1
            continue
        content = fetch(job, session)
        if content is None:
            continue
        cache.put(job.id, content)
        done += 1
    elapsed = time.monotonic() - started
    if elapsed > 30:
        logger.warning("slow batch: %d jobs in %.1fs", len(jobs), elapsed)
    logger.critical("processed %d of %d jobs", done, len(jobs))
    return done


def notify(url: str, payload: dict, outbox: list[dict]) -> None:
    try:
        requests.post(url, json=payload, timeout=5).raise_for_status()
    except requests.RequestException as exc:
        logger.error("notify failed, queued for retry: %s", exc)
        outbox.append(payload)


def run_job(job: Job, session: requests.Session) -> bytes:
    try:
        content = fetch(job, session)
        if content is None:
            raise RuntimeError(f"no content for {job.id}")
        return content
    except Exception:
        logger.exception("job %s failed", job.id)
        raise


def load_config(path: str) -> dict:
    try:
        with open(path) as f:
            return {"dsn": f.read().strip()}
    except FileNotFoundError:
        logger.warning("config %s missing, exiting", path)
        sys.exit(1)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        logger.error("usage: worker <config> <dsn>")
        return 2
    logging.info("starting worker with %s", argv[1])
    config = load_config(argv[1])
    conn = connect(config["dsn"])
    conn.close()
    return 0
