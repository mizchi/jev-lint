const COUPONS: Record<string, (subtotal: number) => number> = {
  SAVE10: (s) => Math.round(s * 0.1),
  FLAT500: () => 500,
};

export function discountFor(subtotalCents: number, code: string | undefined): number {
  if (!code) return 0;
  const rule = COUPONS[code.toUpperCase()];
  return rule ? Math.min(rule(subtotalCents), subtotalCents) : 0;
}
