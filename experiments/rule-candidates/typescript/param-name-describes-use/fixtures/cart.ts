import type { Cart, Product, Pool, Store } from "./types";

export function addToCart(
  cart: Cart,
  items: Product,
): Cart {
  const line = cart.lines.find((l) => l.sku === items.sku);
  if (line) {
    line.qty += 1;
  } else {
    cart.lines.push({ sku: items.sku, price: items.price, qty: 1 });
  }
  return cart;
}

export function addLines(
  cart: Cart,
  items: Product[],
): Cart {
  for (const item of items) {
    cart.lines.push({ sku: item.sku, price: item.price, qty: 1 });
  }
  return cart;
}

export function warmPool(
  pool: Pool,
  isEnabled: number,
): void {
  for (let i = 0; i < isEnabled; i++) {
    pool.spawn();
  }
}

export function withExt(
  name: string,
  prefix: string,
): string {
  if (name.endsWith(prefix)) return name;
  return name + prefix;
}

export function page<T>(
  rows: T[],
  limit: number,
): T[] {
  return rows.slice(limit);
}

export function paginate<T>(
  rows: T[],
  limit: number,
  offset: number,
): T[] {
  return rows.slice(offset, offset + limit);
}

export async function loadCatalog(
  store: Store,
  force: boolean,
): Promise<Product[]> {
  if (!force) {
    const cached = await store.cache.get("catalog");
    if (cached) return cached as Product[];
  }
  const products = await store.db.products.all();
  await store.cache.set("catalog", products);
  return products;
}

export function isEmpty(
  cart: Cart,
): boolean {
  return cart.lines.length === 0;
}

export function total(
  items: Array<{ price: number; qty: number }>,
  taxRate = 0,
): number {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].price * items[i].qty;
  }
  return Math.round(sum * (1 + taxRate) * 100) / 100;
}
