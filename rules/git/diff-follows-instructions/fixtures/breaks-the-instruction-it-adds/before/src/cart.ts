export function total(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}
