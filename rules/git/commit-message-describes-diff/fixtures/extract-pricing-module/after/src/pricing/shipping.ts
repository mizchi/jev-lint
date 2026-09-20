import type { Address } from "./types.ts";

const FREE_SHIPPING_CENTS = 5_000;
const FLAT_SHIPPING_CENTS = 799;

export function shippingFor(subtotalCents: number, address: Address): number {
  if (subtotalCents >= FREE_SHIPPING_CENTS && address.country === "US") return 0;
  return FLAT_SHIPPING_CENTS;
}
