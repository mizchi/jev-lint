import json
import logging
import os
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULTS = {"workers": 4, "poll_seconds": 5}


def load_config(path: Path) -> dict:
    if not path.exists():
        path.write_text(json.dumps(DEFAULTS))
        return dict(DEFAULTS)
    return json.loads(path.read_text())


def retry(fn, attempts: int = 3):
    try:
        return fn()
    except Exception as exc:
        logger.warning("call failed: %s", exc)
        return None


class JobStore:
    def __init__(self, db_path: str) -> None:
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT)")

    def get_job(self, job_id: str) -> dict:
        row = self.conn.execute("SELECT id, state FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            self.conn.execute("INSERT INTO jobs VALUES (?, ?)", (job_id, "pending"))
            self.conn.commit()
            return {"id": job_id, "state": "pending"}
        return {"id": row[0], "state": row[1]}

    def count_pending(self) -> list[str]:
        rows = self.conn.execute("SELECT id FROM jobs WHERE state = 'pending'").fetchall()
        return [r[0] for r in rows]

    def mark_done(self, job_id: str) -> None:
        self.conn.execute("UPDATE jobs SET state = 'done' WHERE id = ?", (job_id,))
        self.conn.commit()

    def to_dict(self) -> dict:
        rows = self.conn.execute("SELECT id, state FROM jobs").fetchall()
        return {r[0]: r[1] for r in rows}

    def close(self) -> None:
        self.conn.close()


def drain(queue: list[dict]) -> list[dict]:
    done = []
    for job in queue:
        done.append(job)
    return done


def handle(event: dict, store: JobStore) -> None:
    if event["type"] == "done":
        store.mark_done(event["id"])
    elif event["type"] == "new":
        store.get_job(event["id"])
    else:
        logger.debug("ignoring %s", event["type"])


def poll_interval(config: dict) -> float:
    raw = os.environ.get("POLL_SECONDS")
    if raw is not None:
        return float(raw)
    return float(config.get("poll_seconds", DEFAULTS["poll_seconds"]))


def run(argv: list[str]) -> int:
    config = load_config(Path(argv[0]) if argv else Path("jobs.json"))
    store = JobStore(":memory:")
    started = time.monotonic()
    while time.monotonic() - started < poll_interval(config):
        for job_id in store.count_pending():
            store.mark_done(job_id)
        time.sleep(0.1)
    store.close()
    return 0
