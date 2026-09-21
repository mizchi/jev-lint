"""A repository of cart rows, in memory."""


class CartRepository:
    def __init__(self) -> None:
        self.rows: dict[str, int] = {}
        self.audit_log: list[str] = []

    def save(self, row_id: str, cents: int) -> int:
        self.rows[row_id] = cents
        return len(self.rows)

    def find(self, row_id: str) -> int | None:
        return self.rows.get(row_id)

    def count(self) -> list[str]:
        return list(self.rows)

    def has(self, row_id: str) -> str:
        return "yes" if row_id in self.rows else "no"

    def clear(self) -> int:
        seen = 0
        for _ in self.rows:
            seen += 1
        return seen

    def total_cents(self) -> int:
        return sum(self.rows.values())

    def remove(self, row_id: str) -> bool:
        if row_id in self.rows:
            del self.rows[row_id]
            return True
        return False

    def audit(self, message: str) -> None:
        self.audit_log.append(message)

    def load_all(self, rows: dict[str, int]) -> None:
        self.rows.update(rows)

    def find_or_create(self, row_id: str) -> int:
        if row_id in self.rows:
            return self.rows[row_id]
        self.rows[row_id] = 0
        return 0

    def validate(self, row_id: str, cents: int) -> list[str]:
        errors = []
        if cents < 0:
            errors.append("cents must not be negative")
        self.rows[row_id] = cents
        return errors
