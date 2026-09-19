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

// DEFECT (fn-name-promises): reads as a predicate, returns a string.
export function isValidEmail(input: string): string {
  return input.trim().toLowerCase();
}

// DEFECT (fn-name-promises): `get` promises a read; this deletes.
export function getCart(id: string): boolean {
  return cache.delete(id);
}

// DEFECT (fn-name-promises, pure-name-is-pure): `calculate` promises a pure computation; this
// writes to module state as a side effect.
export function calculateSubtotal(cart: Cart): number {
  let sum = 0;
  for (const item of cart.items) sum += item.price * item.qty;
  cache.set(cart.currency, cart);
  return sum;
}

// DEFECT (fn-name-promises): named for all items, handles only the first.
export function sumAllQuantities(items: Item[]): number {
  return items.length === 0 ? 0 : items[0].qty;
}

// CLEAN: does exactly what the name says.
export function sumPrices(items: Item[]): number {
  return items.reduce((acc, item) => acc + item.price * item.qty, 0);
}

// CLEAN: the name promises a lookup that may not find anything, and that is
// what the body does.
export function findItemById(items: Item[], id: number): Item | null {
  return items.find((item) => item.id === id) ?? null;
}

// CLEAN: mutating, and says so.
export function removeItem(cart: Cart, id: number): void {
  cart.items = cart.items.filter((item) => item.id !== id);
}

// DEFECT (fn-name-promises): nothing here configures anything -- it takes a
// cart and returns the sum of five unrelated numbers.
//
// This label was added AFTER the first run, which flagged this function at 0.83
// while the corpus called it clean. It is a defect I wrote by accident while
// building a container for the variable cases below, and the honest reading is
// that the rule found it and I had not. Relabelling to agree with a model is
// how a corpus stops being evidence, so the justification has to stand on its
// own -- and it does: a reader of this signature learns nothing true about the
// body. The false positive that prompted it is recorded in docs/findings.md.
export function configure(cart: Cart): number {
  // DEFECT (var-name-describes-value): named seconds, holds milliseconds.
  const timeoutSeconds = 5000;

  // DEFECT (var-name-describes-value): reads as a boolean, holds a string.
  const isAdmin = cart.currency;

  // DEFECT (var-name-describes-value): plural name, single value.
  const items = cart.items[0];

  // CLEAN: name and unit agree.
  const totalCents = sumPrices(cart.items) * 100;

  // CLEAN: name describes the filtered collection.
  const paidItems = cart.items.filter((item) => item.price > 0);

  return timeoutSeconds + isAdmin.length + items.qty + totalCents + paidItems.length;
}
