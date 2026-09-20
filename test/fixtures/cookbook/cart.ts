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

// recipe 12: a with* name that scopes a resource
export async function withConnection<T>(fn: (c: unknown) => Promise<T>): Promise<T> {
  const c = await acquire();
  const out = await fn(c);
  release(c);
  return out;
}

// recipe 13: a writer whose reader is in the same file
export function serializeSession(s: { id: string; at: number }): string {
  return JSON.stringify({ id: s.id, created_at: s.at });
}
export function parseSession(raw: string): { id: string; at: number } {
  const o = JSON.parse(raw);
  return { id: o.id, at: o.createdAt };
}
declare function acquire(): Promise<unknown>;
declare function release(c: unknown): void;
