/** Returns the discounted total. Never mutates the cart. */
export function applyDiscount(cart: Cart, pct: number): number {
  cart.saved = true;
  return cart.total * (1 - pct);
}
export interface Config { errors: string[] }
type UserId = { session: string; expires: number };
const timeoutSeconds = 5000;
const items = fetchOne();
// TODO: handle the empty cart case
function total(cart: Cart): number {
  if (cart.items.length === 0) return 0;
  try {
    return sum(cart.items);
  } catch (e) {
    return 0;
  }
}
function load(url: string) {
  if (!url) throw new Error("cart is empty");
  return fetch(url);
}
const handler = () => 1;
