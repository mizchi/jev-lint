from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class QueryResult:
    rows: list[dict]
    rowcount: int


class Db(Protocol):
    def execute(self, sql: str) -> QueryResult: ...


def read_shard_setting(env: dict[str, str]) -> int:
    return int(env.get("SHARD_COUNT", "1"))


def purge_expired_sessions(db: Db, log) -> None:
    result = db.execute("delete from sessions where expires_at < now()")
    log.info("purged %d sessions", result.rowcount)


def rebuild_search_index(db: Db, search) -> None:
    documents = db.execute("select * from documents").rows
    search.reindex(documents)


def send_digest_emails(db: Db, mailer) -> None:
    users = db.execute("select * from users where digest = true")
    for user in users.rows:
        mailer.send_digest(user)


def rebalance_shards(db: Db, env: dict[str, str], events) -> None:
    shards = read_shard_setting(env)
    if shards <= 1:
        return
    events.rebalance(shards)
