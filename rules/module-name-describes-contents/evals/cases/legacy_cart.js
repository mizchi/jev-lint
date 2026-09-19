// Corpus file, plain JavaScript.

/** Returns the cart total in cents. */
export function cartTotal(items) {
  return items.reduce((a, i) => a + i.price, 0) / 100;
}

/** Returns the items ordered by price, without modifying the input. */
export function byPrice(items) {
  return items.sort((a, b) => a.price - b.price);
}

/** Returns the number of items whose price is above zero. */
export function paidItemCount(items) {
  return items.filter((i) => i.price > 0).length;
}

/** Empties the cart. */
export function emptyCart(cart) {
  cart.items = [];
}
