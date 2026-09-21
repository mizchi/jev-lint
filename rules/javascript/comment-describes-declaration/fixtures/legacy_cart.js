// Corpus file, plain JavaScript.

/** Returns the cart's items sorted by price, cheapest first; ties keep
 *  their original order. */
export function cheapestFirst(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.price - b.item.price || a.index - b.index)
    .map((entry) => entry.item);
}

/** Returns the cart total in cents. */
export function cartTotal(items) {
  return items.reduce((a, i) => a + i.price, 0) / 100;
}

/** Reads `cart.items` directly with no cache, so callers should call
 *  this again after `emptyCart` rather than reusing an earlier count. */
export function itemCount(cart) {
  return cart.items.length;
}

/** Returns the items ordered by price, without modifying the input. */
export function byPrice(items) {
  return items.sort((a, b) => a.price - b.price);
}

/** Applies a discount to the cart. */
export function applyDiscount(cart, percent) {
  cart.items = cart.items.map((item) => ({
    ...item,
    price: item.price - (item.price * percent) / 100,
  }));
}

/** Returns the number of items whose price is above zero. */
export function paidItemCount(items) {
  return items.filter((i) => i.price > 0).length;
}

/** Forwards to `cartTotal` and rounds the result to the nearest cent. */
export function roundedTotal(items) {
  return Math.round(cartTotal(items));
}

/** Empties the cart. */
export function emptyCart(cart) {
  cart.items = [];
}

/** Returns a percentage between 0 and 100 inclusive, even if every item
 *  is free. */
export function paidShare(items) {
  if (items.length === 0) return 0;
  const paid = items.filter((item) => item.price > 0).length;
  return Math.min(100, Math.round((paid / items.length) * 100));
}
