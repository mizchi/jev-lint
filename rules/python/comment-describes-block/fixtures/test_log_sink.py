import sqlite3
import time

from log_sink import LogSink


def make_sink():
    conn = sqlite3.connect(":memory:")
    return LogSink(conn)


def test_append_stores_two_events():
    sink = make_sink()
    # two events
    sink.append("start", {"id": 1})
    sink.append("stop", {"id": 1})
    # verify
    rows = sink.query(limit=10)
    assert len(rows) == 2
    assert rows[0].kind in ("start", "stop")


def test_query_returns_newest_first():
    sink = make_sink()
    sink.append("first", {})
    time.sleep(0.01)
    sink.append("second", {})
    rows = sink.query(limit=2)
    # newest first
    assert rows[0].kind == "second"
    assert rows[1].kind == "first"


def test_prune_keeps_recent_events():
    # the sink used to prune by row count, which dropped fresh events under a
    # burst; this guards the time-based prune that replaced it
    sink = make_sink()
    for i in range(5):
        sink.append("evt", {"i": i})
    sink.prune(max_age_seconds=3600)
    assert len(sink.query(limit=100)) == 5


def test_query_limit_is_respected():
    sink = make_sink()
    for i in range(10):
        sink.append("evt", {"i": i})
    rows = sink.query(limit=3)  # only the three newest
    assert len(rows) == 3


def test_close_is_idempotent():
    sink = make_sink()
    sink.close()
    # a second close must not raise
    sink.close()
