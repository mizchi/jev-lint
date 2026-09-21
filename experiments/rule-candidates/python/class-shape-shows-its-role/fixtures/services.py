"""Classes a reader meets before their call sites."""

import time


class RowStore:
    """Holds rows and answers questions about them."""

    def __init__(self) -> None:
        self.rows: dict[str, int] = {}

    def put(self, row_id: str, cents: int) -> None:
        self.rows[row_id] = cents

    def get(self, row_id: str) -> int | None:
        return self.rows.get(row_id)

    def size(self) -> int:
        return len(self.rows)


class PriceCache:
    def __init__(self) -> None:
        self.name = ""
        self.email = ""

    def set_name(self, name: str) -> None:
        self.name = name

    def get_email(self) -> str:
        return self.email


class ReportBuilder:
    def __init__(self, smtp_host: str) -> None:
        self.rows: list[str] = []
        self.smtp_host = smtp_host

    def add(self, row: str) -> None:
        self.rows.append(row)

    def render(self) -> str:
        return "\n".join(self.rows)

    def send(self, to: str) -> None:
        del to


class RetryingClient:
    def __init__(self, attempts: int, backoff_ms: int) -> None:
        self.attempts = attempts
        self.backoff_ms = backoff_ms

    def delay_for(self, attempt: int) -> int:
        return self.backoff_ms * attempt

    def should_retry(self, attempt: int) -> bool:
        return attempt < self.attempts


class InvoiceTotals:
    def __init__(self, locale: str) -> None:
        self.lines: list[int] = []
        self.locale = locale

    def add_line(self, cents: int) -> None:
        self.lines.append(cents)

    def total_cents(self) -> int:
        return sum(self.lines)

    def formatted(self) -> str:
        return f"{self.total_cents() / 100:.2f} ({self.locale})"


class SessionConfig:
    def __init__(self) -> None:
        self.timeout_ms = 30_000
        self.current_user: str | None = None
        self.request_id: str | None = None
        self.started_at = 0.0

    def timeout(self) -> int:
        return self.timeout_ms

    def begin_request(self, request_id: str, user: str) -> None:
        self.request_id = request_id
        self.current_user = user
        self.started_at = time.time()

    def end_request(self) -> float:
        self.request_id = None
        self.current_user = None
        return time.time() - self.started_at

    def user(self) -> str | None:
        return self.current_user


class Clock:
    def now(self) -> float:
        return time.time()


class CsvParser:
    def __init__(self, separator: str) -> None:
        self.separator = separator
        self.smtp_port = 25

    def parse(self, line: str) -> list[str]:
        return line.split(self.separator)

    def header(self, line: str) -> list[str]:
        return self.parse(line)
