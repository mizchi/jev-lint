// Corpus file. Every defect here is a NAMING defect: the code runs, the types
// check, and no existing linter has anything to say about it. What is wrong is
// only visible to a reader who understands both the name and the body.
//
// Labels live in corpus/labels.json with the reason for each.

const cache = new Map<string, Cart>();

export interface Cart {
  items: Item[];
  currency: string;
}

export interface Item {
  id: number;
  price: number;
  qty: number;
}

export function isValidEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function getCart(id: string): boolean {
  return cache.delete(id);
}

export function calculateSubtotal(cart: Cart): number {
  let sum = 0;
  for (const item of cart.items) sum += item.price * item.qty;
  cache.set(cart.currency, cart);
  return sum;
}

export function sumAllQuantities(items: Item[]): number {
  return items.length === 0 ? 0 : items[0].qty;
}

export function sumPrices(items: Item[]): number {
  return items.reduce((acc, item) => acc + item.price * item.qty, 0);
}

export function findItemById(items: Item[], id: number): Item | null {
  return items.find((item) => item.id === id) ?? null;
}

export function removeItem(cart: Cart, id: number): void {
  cart.items = cart.items.filter((item) => item.id !== id);
}

export function configure(cart: Cart): number {
  const timeoutSeconds = 5000;
  setTimeout(() => cache.delete(cart.currency), timeoutSeconds);

  const isAdmin = cart.currency;

  const items = cart.items[0];

  const totalCents = sumPrices(cart.items) * 100;

  const paidItems = cart.items.filter((item) => item.price > 0);

  return timeoutSeconds + isAdmin.length + items.qty + totalCents + paidItems.length;
}
