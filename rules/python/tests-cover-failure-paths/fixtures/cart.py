from __future__ import annotations

import re
from dataclasses import dataclass, field

SKU = re.compile(r"^[A-Z]{2}-\d{4}$")
COUPONS = {"SAVE10": 10, "SAVE20": 20}


@dataclass
class Item:
    sku: str
    price_cents: int
    qty: int = 1


@dataclass
class Cart:
    items: list[Item] = field(default_factory=list)


@dataclass
class Receipt:
    ok: bool
    total_cents: int = 0
    reason: str = ""


def parse_sku(raw: str) -> str:
    sku = raw.strip().upper()
    if not SKU.match(sku):
        raise ValueError(f"bad sku: {raw!r}")
    return sku


def add_item(cart: Cart, raw_sku: str, price_cents: int, qty: int = 1) -> Item:
    if qty <= 0:
        raise ValueError("qty must be positive")
    item = Item(sku=parse_sku(raw_sku), price_cents=price_cents, qty=qty)
    cart.items.append(item)
    return item


def remove_item(cart: Cart, sku: str) -> Item:
    for i, item in enumerate(cart.items):
        if item.sku == sku:
            return cart.items.pop(i)
    raise KeyError(sku)


def total(cart: Cart) -> int:
    return sum(i.price_cents * i.qty for i in cart.items)


def apply_coupon(cart: Cart, code: str) -> int | None:
    percent = COUPONS.get(code)
    if percent is None:
        return None
    return total(cart) * (100 - percent) // 100


def discount_for(cart: Cart, code: str) -> int:
    percent = COUPONS.get(code, 0)
    return total(cart) * percent // 100


def checkout(cart: Cart, card_expires: str, today: str) -> Receipt:
    if card_expires < today:
        raise ValueError("card expired")
    if not cart.items:
        return Receipt(ok=False, reason="empty cart")
    return Receipt(ok=True, total_cents=total(cart))


def truncate_sku(raw: str, width: int = 7) -> str:
    if not raw:
        raise ValueError("empty sku")
    return raw[:width]
