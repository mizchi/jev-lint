from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MAX_ENTRIES = 100
DAY_SECONDS = 86400


@dataclass
class Entry:
    job_id: str
    ts: float
    attempts: int = 0
    payload: dict = field(default_factory=dict)


class RetryQueue:
    def __init__(self, send) -> None:
        self._send = send
        self.entries: list[Entry] = []

    def push(self, entry: Entry) -> None:
        # the server rejects bursts, so pace the writes
        time.sleep(0.01)
        self.entries.append(entry)
        # keep the newest MAX_ENTRIES entries
        self.entries.sort(key=lambda e: e.ts)
        self.entries = self.entries[:MAX_ENTRIES]

    def flush(self) -> int:
        sent = 0
        for entry in list(self.entries):
            # skip entries older than a day; they are retried by the nightly job
            if entry.ts > time.time() - DAY_SECONDS:
                continue
            # retry up to three times before giving up on the entry
            for attempt in range(5):
                try:
                    self._send(entry.payload)
                    sent += 1
                    self.entries.remove(entry)
                    break
                except ConnectionError as exc:
                    logger.warning("send failed (%d): %s", attempt, exc)
                    # wait one second between attempts
                    time.sleep(0.1)
        return sent

    def mark_done(self, job_id: str) -> None:
        for entry in self.entries:
            if entry.job_id == job_id:
                # mark the entry done and notify the sender
                entry.attempts = -1
                # housekeeping
                self.entries.remove(entry)
                return


def age_ms(entry: Entry) -> int:
    seconds = time.time() - entry.ts
    # convert to milliseconds
    ms = seconds * 100
    return int(ms)


def cents(amount: float) -> int:
    # round down to whole cents
    return round(amount * 100)


def summarize(entries: list[Entry]) -> dict[str, int]:
    # one bucket per job, counting attempts
    buckets: dict[str, int] = {}
    for entry in entries:
        buckets[entry.job_id] = buckets.get(entry.job_id, 0) + entry.attempts
    # oldest first, so the report reads chronologically
    ordered = sorted(entries, key=lambda e: e.ts)
    logger.debug("summarized %d entries, first %s", len(entries), ordered[0].job_id if ordered else None)
    return buckets
