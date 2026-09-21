export interface Row {
  id: string;
  cents: number;
}

export class CartRepository {
  private rows = new Map<string, Row>();
  private auditLog: string[] = [];

  save(row: Row): number {
    this.rows.set(row.id, row);
    return this.rows.size;
  }

  find(id: string): Row | null {
    return this.rows.get(id) ?? null;
  }

  count(): Row[] {
    return [...this.rows.values()];
  }

  has(id: string): string {
    return this.rows.has(id) ? "yes" : "no";
  }

  clear(): number {
    let seen = 0;
    for (const _ of this.rows.values()) seen += 1;
    return seen;
  }

  totalCents(): number {
    let sum = 0;
    for (const row of this.rows.values()) sum += row.cents;
    return sum;
  }

  remove(id: string): boolean {
    return this.rows.delete(id);
  }

  audit(message: string): void {
    this.auditLog.push(message);
  }

  loadAll(rows: Row[]): void {
    for (const row of rows) this.rows.set(row.id, row);
  }

  findOrCreate(id: string): Row {
    const found = this.rows.get(id);
    if (found) return found;
    const created = { id, cents: 0 };
    this.rows.set(id, created);
    return created;
  }

  validate(row: Row): string[] {
    const errors: string[] = [];
    if (row.cents < 0) errors.push("cents must not be negative");
    this.rows.set(row.id, row);
    return errors;
  }
}
