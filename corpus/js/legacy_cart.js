// Corpus file, plain JavaScript.
// CLEAN (module-name-describes-contents): named for what it holds.
//
// This file exists so the `-js` rule variants are exercised rather than merely
// shipped. The naming and comment packs each have a JavaScript variant whose
// matcher omits the TypeScript-only node kinds, and a variant no corpus covers
// is a variant nobody has measured. The end-to-end test asserts every shipped
// rule matches something here or elsewhere in the corpus, which is what caught
// this gap.

// DEFECT (comment-describes-declaration): says it returns cents, returns
// whole units.
/** Returns the cart total in cents. */
export function cartTotal(items) {
  return items.reduce((a, i) => a + i.price, 0) / 100;
}

// DEFECT (comment-describes-declaration): claims it leaves the input alone,
// and it sorts in place.
/** Returns the items ordered by price, without modifying the input. */
export function byPrice(items) {
  return items.sort((a, b) => a.price - b.price);
}

// CLEAN: accurate.
/** Returns the number of items whose price is above zero. */
export function paidItemCount(items) {
  return items.filter((i) => i.price > 0).length;
}

// CLEAN: vague but not false.
/** Empties the cart. */
export function emptyCart(cart) {
  cart.items = [];
}
