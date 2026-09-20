export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type Maybe<T> = T | null | undefined;

export interface Repository<T extends { id: string }> {
  find(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export function parseOrder(raw: Json): { id: string; lines: { sku: string; qty: number }[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("order must be an object");
  }
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    id: String(raw.id),
    lines: lines.map((l) => ({ sku: String((l as { sku: Json }).sku), qty: Number((l as { qty: Json }).qty) })),
  };
}

export type Order = ReturnType<typeof parseOrder>;

export function tryParseOrder(raw: Json): Result<Order, string> {
  try {
    return { ok: true, value: parseOrder(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export class MemoryRepository<T extends { id: string }> implements Repository<T> {
  private readonly rows = new Map<string, T>();
  async find(id: string): Promise<Maybe<T>> {
    return this.rows.get(id) ?? null;
  }
  async save(entity: T): Promise<void> {
    this.rows.set(entity.id, entity);
  }
  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}
