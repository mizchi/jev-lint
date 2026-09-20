import type { Address, CartItem } from "./types.ts";

const TAX_RATES: Record<string, number> = { "US-CA": 0.0725, "US-NY": 0.04, "DE": 0.19, "JP": 0.1 };

export function taxFor(items: CartItem[], address: Address): number {
  const rate = TAX_RATES[`${address.country}-${address.region}`] ?? TAX_RATES[address.country] ?? 0;
  const taxable = items.filter((i) => i.taxable).reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  return Math.round(taxable * rate);
}
