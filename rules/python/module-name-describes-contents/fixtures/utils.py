from datetime import datetime, timedelta


def percent_off(amount_cents: int, percent: int) -> int:
    return round(amount_cents * (100 - percent) / 100)


def apply_coupon_code(amount_cents: int, code: str) -> int:
    if code == "SAVE10":
        return percent_off(amount_cents, 10)
    if code == "SAVE20":
        return percent_off(amount_cents, 20)
    return amount_cents


def is_coupon_expired(issued_at: datetime, valid_days: int) -> bool:
    return datetime.now() - issued_at > timedelta(days=valid_days)


def best_discount(amount_cents: int, codes: list[str]) -> int:
    return min((apply_coupon_code(amount_cents, c) for c in codes), default=amount_cents)
