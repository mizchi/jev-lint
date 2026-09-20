export interface CartLine {
  sku: string;
  qty: number;
  unitCents: number;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  couponCode?: string;
}

export interface Coupon {
  code: string;
  percentOff: number;
  expiresAt: number;
}

export function cartTotal(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.qty * line.unitCents, 0);
}

export function applyCoupon(cart: Cart, coupon: Coupon, now: number): Cart {
  if (cart.lines.length === 0) {
    throw new Error(`basket ${cart.id} is empty; nothing to discount`);
  }
  if (coupon.expiresAt <= now) {
    throw new Error(`coupon ${coupon.code} expired`);
  }
  const factor = (100 - coupon.percentOff) / 100;
  return {
    ...cart,
    couponCode: coupon.code,
    lines: cart.lines.map((line) => ({ ...line, unitCents: Math.round(line.unitCents * factor) })),
  };
}

export function removeItem(cart: Cart, sku: string): Cart {
  const index = cart.lines.findIndex((line) => line.sku === sku);
  if (index === -1) {
    throw new Error(`sku ${sku} is not in basket ${cart.id}`);
  }
  return { ...cart, lines: cart.lines.filter((_, i) => i !== index) };
}

export function checkoutCart(cart: Cart): { orderId: string; totalCents: number } {
  if (cart.lines.length === 0) {
    throw new Error("cannot check out an empty cart");
  }
  return { orderId: `order-${cart.id}`, totalCents: cartTotal(cart) };
}
