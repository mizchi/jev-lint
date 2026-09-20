import sqlite3
from dataclasses import dataclass
from typing import Optional


class NotFound(LookupError):
    pass


class Conflict(RuntimeError):
    pass


@dataclass
class Job:
    id: int
    name: str
    state: str


def _require_row(cur: sqlite3.Cursor, job_id: int) -> tuple:
    row = cur.fetchone()
    if row is None:
        raise NotFound(f"job {job_id}")
    return row


class JobRepo:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get(self, job_id: int) -> Job:
        """Return the job with this id.

        Raises:
            NotFound: if no job has this id.
        """
        cur = self.conn.execute("SELECT id, name, state FROM jobs WHERE id = ?", (job_id,))
        return Job(*_require_row(cur, job_id))

    def find(self, job_id: int) -> Optional[Job]:
        """Return the job with this id.

        Returns:
            The job, or None if no job has this id.
        Raises:
            sqlite3.OperationalError: if the jobs table does not exist.
        """
        cur = self.conn.execute("SELECT id, name, state FROM jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()
        if row is None:
            return None
        return Job(*row)

    def by_name(self, name: str) -> Job:
        """Return the job with this name.

        Raises:
            NotFound: if no job has this name.
        """
        cur = self.conn.execute("SELECT id, name, state FROM jobs WHERE name = ?", (name,))
        row = cur.fetchone()
        if row is None:
            return None
        return Job(*row)

    def create(self, name: str) -> Job:
        """Insert a job in the ``queued`` state.

        Raises:
            Conflict: if a job with this name already exists.
        """
        try:
            cur = self.conn.execute("INSERT INTO jobs (name, state) VALUES (?, 'queued')", (name,))
        except sqlite3.IntegrityError as e:
            raise Conflict(f"job {name!r} already exists") from e
        return Job(cur.lastrowid, name, "queued")

    def start(self, job_id: int) -> None:
        """Move a queued job to ``running``.

        Raises:
            NotFound: if no job has this id.
        """
        job = self.get(job_id)
        if job.state != "queued":
            raise Conflict(f"job {job_id} is {job.state}, not queued")
        self.conn.execute("UPDATE jobs SET state = 'running' WHERE id = ?", (job_id,))

    def delete(self, job_id: int) -> bool:
        """Delete a job.

        Returns:
            True if a job was deleted, False if none had this id.
        Raises:
            Conflict: if the job is still running.
        """
        job = self.find(job_id)
        if job is None:
            return False
        if job.state == "running":
            raise Conflict(f"job {job_id} is running")
        self.conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        return True

    def rename(self, job_id: int, name: str) -> None:
        """Rename a job.

        Raises:
            NotFound: if no job has this id.
            ValueError: if ``name`` is empty.
        """
        if not name:
            raise ValueError("name must not be empty")
        self.get(job_id)
        self.conn.execute("UPDATE jobs SET name = ? WHERE id = ?", (name, job_id))

    def count(self, state: str) -> int:
        """Count the jobs in a state.

        Returns:
            The number of jobs, or None if the state is unknown.
        """
        if state not in ("queued", "running", "done"):
            raise ValueError(f"unknown state {state!r}")
        cur = self.conn.execute("SELECT COUNT(*) FROM jobs WHERE state = ?", (state,))
        return cur.fetchone()[0]
