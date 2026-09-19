import { http } from "./http.ts";
import { cache } from "./cache.ts";
import type { Product } from "../model.ts";

const TTL_MS = 5 * 60 * 1000;

// Network read: always hits the catalog service.
export async function fetchProduct(id: string): Promise<Product> {
  const res = await http.get(`/catalog/products/${id}`);
  if (res.status === 404) throw new Error(`product ${id} not found`);
  const product = res.body as Product;
  cache.set(`product:${id}`, product, TTL_MS);
  return product;
}

// Cache read: synchronous, and undefined when the entry is missing or stale.
export function getProduct(id: string): Product | undefined {
  return cache.get<Product>(`product:${id}`);
}

// Cache first, network on a miss.
export async function loadProduct(id: string): Promise<Product> {
  return getProduct(id) ?? (await fetchProduct(id));
}

export function evictProduct(id: string): void {
  cache.delete(`product:${id}`);
}
