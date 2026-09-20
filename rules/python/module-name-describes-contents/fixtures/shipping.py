from dataclasses import dataclass

TAX_RATES = {"CA": 0.0725, "NY": 0.04, "OR": 0.0}


@dataclass
class TaxLine:
    region: str
    rate: float
    amount_cents: int


def tax_rate(region: str) -> float:
    return TAX_RATES.get(region, 0.0)


def tax_for(amount_cents: int, region: str) -> TaxLine:
    rate = tax_rate(region)
    return TaxLine(region=region, rate=rate, amount_cents=round(amount_cents * rate))


def is_tax_exempt(region: str) -> bool:
    return tax_rate(region) == 0.0
