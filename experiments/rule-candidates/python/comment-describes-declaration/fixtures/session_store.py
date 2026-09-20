from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class Session:
    id: str
    user: str
    created_at: float
    hits: int = 0
    tags: list[str] = field(default_factory=list)


# Thread-safe: every public method takes the store's lock before touching
# the sessions dict.
class SessionStore:
    """In-memory session store keyed by session id."""

    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._sessions: dict[str, Session] = {}
        self._ttl = ttl_seconds

    # Returns the remaining TTL in milliseconds.
    def ttl(self, session: Session) -> float:
        return max(0.0, session.created_at + self._ttl - time.time())

    def touch(self, session_id: str) -> Session:
        """Refresh a session's activity. Does not mutate the session."""
        session = self._sessions[session_id]
        session.hits += 1
        return session

    # Sessions ordered newest first.
    def recent(self, limit: int = 10) -> list[Session]:
        ordered = sorted(self._sessions.values(), key=lambda s: s.created_at)
        return ordered[:limit]

    def create(self, user: str) -> Session:
        """Create a session for `user`.

        Args:
            user: the owner of the session.
            ttl_seconds: how long the session lives before expiring.
        """
        session = Session(id=f"{user}-{int(time.time() * 1000)}", user=user, created_at=time.time())
        self._sessions[session.id] = session
        return session

    def revoke(self, session_id: str) -> bool:
        """Remove the session. Raises KeyError for an unknown id."""
        if session_id not in self._sessions:
            return False
        del self._sessions[session_id]
        return True

    # Callers must hold the store's lock for the duration of the iteration.
    def __iter__(self):
        return iter(list(self._sessions.values()))

    def __len__(self) -> int:
        """Number of sessions, expired ones included."""
        return len(self._sessions)

    # Used to be a coroutine; made synchronous in 2.0 because nothing awaited it.
    def purge(self) -> int:
        expired = [s.id for s in self._sessions.values() if self.ttl(s) <= 0]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)


# ---------------------------------------------------------------- helpers


def tag(session: Session, label: str) -> None:
    """Add a tag."""
    if label not in session.tags:
        session.tags.append(label)


# O(1): a dict lookup, no scan.
def find(store: SessionStore, session_id: str) -> Session | None:
    return store._sessions.get(session_id)


# Retries the probe up to three times before giving up.
def probe(fn) -> bool:
    for _ in range(5):
        if fn():
            return True
    return False
