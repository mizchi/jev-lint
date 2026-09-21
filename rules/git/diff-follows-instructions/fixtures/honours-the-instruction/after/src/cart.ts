export function total(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

export function applyCoupon(total: number, code: string): number {
  return code === "SAVE10" ? total * 0.9 : total;
}
