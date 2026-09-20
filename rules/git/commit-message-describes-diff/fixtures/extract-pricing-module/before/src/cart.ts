export interface CartItem {
  sku: string;
  priceCents: number;
  quantity: number;
  taxable: boolean;
}

export interface Address {
  country: string;
  region: string;
}

const TAX_RATES: Record<string, number> = { "US-CA": 0.0725, "US-NY": 0.04, "DE": 0.19, "JP": 0.1 };

export function taxFor(items: CartItem[], address: Address): number {
  const rate = TAX_RATES[`${address.country}-${address.region}`] ?? TAX_RATES[address.country] ?? 0;
  const taxable = items.filter((i) => i.taxable).reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  return Math.round(taxable * rate);
}

const FREE_SHIPPING_CENTS = 5_000;
const FLAT_SHIPPING_CENTS = 799;

export function shippingFor(subtotalCents: number, address: Address): number {
  if (subtotalCents >= FREE_SHIPPING_CENTS && address.country === "US") return 0;
  return FLAT_SHIPPING_CENTS;
}

const COUPONS: Record<string, (subtotal: number) => number> = {
  SAVE10: (s) => Math.round(s * 0.1),
  FLAT500: () => 500,
};

export function discountFor(subtotalCents: number, code: string | undefined): number {
  if (!code) return 0;
  const rule = COUPONS[code.toUpperCase()];
  return rule ? Math.min(rule(subtotalCents), subtotalCents) : 0;
}

export function subtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
}

export function total(items: CartItem[], address: Address, coupon?: string): number {
  const sub = subtotal(items);
  return sub - discountFor(sub, coupon) + taxFor(items, address) + shippingFor(sub, address);
}
