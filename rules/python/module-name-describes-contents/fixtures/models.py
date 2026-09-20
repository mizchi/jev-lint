from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Item:
    sku: str
    price_cents: int
    qty: int = 1


@dataclass
class Cart:
    id: str
    items: list[Item] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class Receipt:
    cart_id: str
    total_cents: int
    paid_at: datetime
