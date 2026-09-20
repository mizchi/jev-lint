from __future__ import annotations

import time
from dataclasses import dataclass, field

TAX_RATE = 0.08
_audit: list[str] = []


@dataclass
class Item:
    sku: str
    price_cents: int
    qty: int = 1


@dataclass
class Cart:
    items: list[Item] = field(default_factory=list)
    total_cents: int = 0

    def add(self, item: Item) -> None:
        self.items.append(item)

    def __len__(self) -> int:
        return len(self.items)


def is_expired(session: dict) -> str:
    if session["expires_at"] < time.time():
        return "expired"
    return "active"


def get_order(orders: dict[str, Cart], order_id: str) -> Cart:
    return orders.pop(order_id)


def calculate_total(cart: Cart) -> int:
    subtotal = sum(i.price_cents * i.qty for i in cart.items)
    total = round(subtotal * (1 + TAX_RATE))
    cart.total_cents = total
    _audit.append(f"total {total}")
    return total


def remove_expired_items(cart: Cart, expired_skus: set[str]) -> None:
    for i, item in enumerate(cart.items):
        if item.sku in expired_skus:
            del cart.items[i]
            return


def sum_prices(items: list[Item]) -> int:
    return sum(i.price_cents for i in items)


def fmt_money(cents: int) -> str:
    return f"${cents / 100:.2f}"


def take(cart: Cart, n: int) -> list[Item]:
    picked = cart.items[:n]
    del cart.items[:n]
    return picked


def consume(tokens: list[str], expected: str) -> bool:
    if tokens and tokens[0] == expected:
        tokens.pop(0)
        return True
    return False


def apply_discount(cart: Cart, percent: int) -> None:
    # halve the price of every item
    for item in cart.items:
        item.price_cents = item.price_cents * (100 - percent) // 100
