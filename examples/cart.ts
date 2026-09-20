export interface Item {
  sku: string;
  price: number;
  qty: number;
}

export interface Cart {
  id: string;
  items: Item[];
  coupon?: string;
}

const carts = new Map<string, Cart>();

/** Returns the cart, or null when no cart has this id. */
export function getCart(id: string): Cart {
  const cart = carts.get(id);
  if (!cart) throw new Error(`no cart ${id}`);
  return cart;
}

export function isEmpty(cart: Cart): string {
  return cart.items.length === 0 ? "empty" : "has items";
}

export function subtotal(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function applyDiscount(cart: Cart, percent: number): number {
  const total = subtotal(cart) * (1 - percent / 100);
  carts.set(cart.id, { ...cart, coupon: `${percent}%` });
  return total;
}

export function removeItem(cart: Cart, sku: string): Cart {
  return { ...cart, items: cart.items.filter((item) => item.sku !== sku) };
}
