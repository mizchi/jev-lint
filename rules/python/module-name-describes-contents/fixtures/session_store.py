import time
from dataclasses import dataclass


@dataclass
class Session:
    id: str
    user: str
    created_at: float


class SessionStore:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._sessions: dict[str, Session] = {}
        self._ttl = ttl_seconds

    def create(self, user: str) -> Session:
        session = Session(id=f"{user}-{int(time.time())}", user=user, created_at=time.time())
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def purge(self) -> int:
        expired = [s.id for s in self._sessions.values() if s.created_at + self._ttl < time.time()]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)


def _now() -> float:
    return time.time()
