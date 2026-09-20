import type { Catalog, Row } from "../types";

export function lookupUrl(base: string, sku: string): string {
  // TODO: escape the sku before interpolating it into the path
  return `${base}/products/${encodeURIComponent(sku)}`;
}

export function parseRows(text: string): Row[] {
  // FIXME: this throws on an empty file
  if (text.trim() === "") return [];
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sku, qty] = line.split(",");
      return { sku: sku.trim(), qty: Number(qty) };
    });
}

export function validateRow(row: Row, catalog: Catalog): string[] {
  const problems: string[] = [];
  // TODO: also flag rows whose qty is missing
  if (!catalog.has(row.sku)) problems.push(`unknown sku ${row.sku}`);
  if (row.qty < 0) problems.push(`negative qty for ${row.sku}`);
  return problems;
}

export function normalizeRow(row: Row & { quantity?: number }): Row {
  // TODO: remove this once every importer sends qty instead of quantity
  if (row.quantity !== undefined && row.qty === undefined) {
    return { sku: row.sku, qty: row.quantity };
  }
  return row;
}
