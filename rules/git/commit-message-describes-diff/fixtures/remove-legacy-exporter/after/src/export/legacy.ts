import type { Order } from "../orders/types.ts";

const HEADER = ["id", "customer", "total_cents", "created_at"];

function escape(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * @deprecated Use `exportCsv`. Kept for the one partner feed that still
 * reads the cents column; goes away in v3.
 */
export function exportLegacyCsv(orders: Order[]): string {
  const rows = orders.map((o) => [
    o.id,
    o.customerEmail,
    String(o.totalCents),
    o.createdAt.toISOString(),
  ]);
  return [HEADER, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}
