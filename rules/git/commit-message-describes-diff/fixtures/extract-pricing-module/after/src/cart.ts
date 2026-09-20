import { discountFor, shippingFor, taxFor } from "./pricing/index.ts";
import type { Address, CartItem } from "./pricing/types.ts";

export type { Address, CartItem } from "./pricing/types.ts";
export { discountFor, shippingFor, taxFor } from "./pricing/index.ts";

export function subtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
}

export function total(items: CartItem[], address: Address, coupon?: string): number {
  const sub = subtotal(items);
  return sub - discountFor(sub, coupon) + taxFor(items, address) + shippingFor(sub, address);
}
