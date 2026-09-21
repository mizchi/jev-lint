export function total(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

export function summarize(items: number[]): { total: number; count: number } {
  const cart: any = { total: total(items), count: items.length };
  return cart;
}
