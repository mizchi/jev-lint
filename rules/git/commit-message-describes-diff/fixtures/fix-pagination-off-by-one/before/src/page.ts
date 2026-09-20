export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
}

/** `page` is 1-based, as it is in the URL. */
export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = current * size;
  return { items: items.slice(start, start + size), page: current, pageCount };
}
