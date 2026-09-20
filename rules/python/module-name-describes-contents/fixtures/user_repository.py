import sqlite3
from dataclasses import dataclass


@dataclass
class User:
    id: int
    email: str


@dataclass
class Order:
    id: int
    user_id: int
    total_cents: int


class UserRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def find_user(self, user_id: int) -> User | None:
        row = self.conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
        return User(*row) if row else None

    def find_order(self, order_id: int) -> Order | None:
        row = self.conn.execute("SELECT id, user_id, total_cents FROM orders WHERE id = ?", (order_id,)).fetchone()
        return Order(*row) if row else None

    def orders_for_cart(self, cart_id: int) -> list[Order]:
        rows = self.conn.execute("SELECT id, user_id, total_cents FROM orders WHERE cart_id = ?", (cart_id,)).fetchall()
        return [Order(*r) for r in rows]

    def unpaid_invoices(self) -> list[int]:
        rows = self.conn.execute("SELECT id FROM invoices WHERE paid = 0").fetchall()
        return [r[0] for r in rows]
