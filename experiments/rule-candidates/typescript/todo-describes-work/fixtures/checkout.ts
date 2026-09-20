import type { Cart, Coupon, CouponRepo, HttpClient, Quote, TaxRates } from "../types";

export class CouponError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function priceCart(cart: Cart, rates: TaxRates): Quote {
  // TODO: handle the empty cart
  if (cart.items.length === 0) {
    return { lines: [], subtotal: 0, tax: 0, total: 0 };
  }
  const lines = cart.items.map((item) => ({
    sku: item.sku,
    qty: item.qty,
    amount: item.unitPrice * item.qty,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const tax = Math.round(subtotal * rates[cart.region]);
  return { lines, subtotal, tax, total: subtotal + tax };
}

export async function submitOrder(client: HttpClient, order: unknown, opts: { maxAttempts: number; delayMs: number }) {
  // FIXME: retries are unbounded, a dead upstream spins forever
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await client.post("/orders", order);
    } catch (e) {
      if (attempt === opts.maxAttempts) throw e;
      await sleep(opts.delayMs);
    }
  }
  throw new Error("unreachable");
}

export function mergeCarts(a: Cart, b: Cart): Cart {
  // TODO: dedupe items that appear in both carts
  const seen = new Set<string>();
  const items = [];
  for (const item of [...a.items, ...b.items]) {
    if (seen.has(item.sku)) continue;
    seen.add(item.sku);
    items.push(item);
  }
  return { region: a.region, items };
}

export function estimateShipping(cart: Cart, destination: string): number {
  // TODO: compute the real estimate from the carrier rate table
  return 0;
}

export async function applyCoupon(cart: Cart, code: string, repo: CouponRepo): Promise<Cart> {
  // TODO: also reject coupons whose campaign has ended
  const coupon: Coupon | null = await repo.findCoupon(code);
  if (!coupon) throw new CouponError("unknown coupon");
  if (coupon.expiresAt < Date.now()) throw new CouponError("coupon expired");
  return { ...cart, coupon: coupon.code };
}
