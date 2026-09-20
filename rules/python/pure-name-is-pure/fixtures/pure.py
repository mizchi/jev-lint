from __future__ import annotations

import argparse
import hashlib
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

TAX_RATES = {"CA": 0.0725, "NY": 0.04}
_DEFAULT_CURRENCY = "USD"
_key_cache: dict[str, bytes] = {}


@dataclass
class Order:
    id: str
    items: list[tuple[str, int]] = field(default_factory=list)
    region: str = "CA"
    shipping_cents: int = 0

    def to_dict(self) -> dict:
        return {"id": self.id, "items": list(self.items), "region": self.region}


def calculate_shipping(order: Order) -> int:
    weight = sum(qty for _, qty in order.items)
    cents = 500 + 100 * max(0, weight - 1)
    order.shipping_cents = cents
    return cents


def calculate_tax(amount_cents: int, region: str) -> int:
    return round(amount_cents * TAX_RATES.get(region, 0.0))


def compute_totals(orders: list[Order]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for order in orders:
        totals[order.id] = sum(qty * 100 for _, qty in order.items)
    return totals


def compute_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compute_hash(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def derive_key(password: str, salt: bytes) -> bytes:
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    _key_cache[password] = key
    return key


def derive_slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def derive_settings(base: dict, overrides: dict) -> dict:
    merged = dict(base)
    merged.update(overrides)
    return merged


def format_money(cents: int, currency: str | None = None) -> str:
    return f"{cents / 100:.2f} {currency or _DEFAULT_CURRENCY}"


def format_receipt(order: Order) -> str:
    lines = [f"{sku} x{qty}" for sku, qty in order.items]
    text = "\n".join(lines)
    logger.info("formatted receipt for %s", order.id)
    return text


def format_table(rows: list[tuple[str, int]]) -> str:
    ordered = sorted(rows, key=lambda r: r[1], reverse=True)
    return "\n".join(f"{name:<20}{n:>6}" for name, n in ordered)


def format_row(row: tuple[str, int], counters: dict[str, int]) -> str:
    counters["rows"] += 1
    return f"{row[0]},{row[1]}"


def to_timestamp(value: str | None) -> float:
    if value is None:
        return time.time()
    return float(value)


def to_rows(orders: list[Order]) -> list[tuple[str, int]]:
    out = []
    for order in orders:
        out.append((order.id, len(order.items)))
    return out


def parse_int(raw: str) -> int:
    return int(raw.strip())


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="orders")
    parser.add_argument("--region", default="CA")
    parser.add_argument("--limit", type=int, default=10)
    return parser.parse_args(argv)
