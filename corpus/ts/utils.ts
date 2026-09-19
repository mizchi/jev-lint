// Corpus file.
// DEFECT (module-name-describes-contents): every item here is
// about one nameable concern -- discounts -- and the file is called `utils`.
// A reader looking for the discount logic has no reason to open this.

export function percentOff(amount: number, percent: number): number {
  return Math.round(amount * (1 - percent / 100));
}

export function applyCouponCode(amount: number, code: string): number {
  if (code === "SAVE10") return percentOff(amount, 10);
  if (code === "SAVE20") return percentOff(amount, 20);
  return amount;
}

export function isCouponExpired(issuedAt: Date, validDays: number): boolean {
  const ageMs = Date.now() - issuedAt.getTime();
  return ageMs > validDays * 24 * 60 * 60 * 1000;
}

export function bestDiscount(amount: number, codes: string[]): number {
  return codes.reduce((best, code) => Math.min(best, applyCouponCode(amount, code)), amount);
}
