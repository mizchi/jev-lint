export interface Row {
  id: string;
  cents: number;
}

/** Holds rows and answers questions about them. */
export class RowStore {
  private rows = new Map<string, Row>();

  put(row: Row): void {
    this.rows.set(row.id, row);
  }

  get(id: string): Row | null {
    return this.rows.get(id) ?? null;
  }

  size(): number {
    return this.rows.size;
  }
}

export class PriceCache {
  private profile: { name: string; email: string } = { name: "", email: "" };

  setName(name: string): void {
    this.profile.name = name;
  }

  email(): string {
    return this.profile.email;
  }
}

export class ReportBuilder {
  private rows: Row[] = [];
  private smtpHost = "localhost";

  add(row: Row): void {
    this.rows.push(row);
  }

  render(): string {
    return this.rows.map((r) => `${r.id} ${r.cents}`).join("\n");
  }

  send(to: string): void {
    void to;
    void this.smtpHost;
  }
}

export class RetryingClient {
  private attempts: number;
  private backoffMs: number;

  constructor(attempts: number, backoffMs: number) {
    this.attempts = attempts;
    this.backoffMs = backoffMs;
  }

  delayFor(attempt: number): number {
    return this.backoffMs * attempt;
  }

  shouldRetry(attempt: number): boolean {
    return attempt < this.attempts;
  }
}

export class InvoiceTotals {
  private lines: Row[] = [];
  private locale: string;

  constructor(locale: string) {
    this.locale = locale;
  }

  addLine(line: Row): void {
    this.lines.push(line);
  }

  totalCents(): number {
    return this.lines.reduce((sum, line) => sum + line.cents, 0);
  }

  formatted(): string {
    return new Intl.NumberFormat(this.locale).format(this.totalCents() / 100);
  }
}

export class SessionConfig {
  private timeoutMs = 30_000;
  private currentUser: string | null = null;
  private requestId: string | null = null;
  private startedAt = 0;

  timeout(): number {
    return this.timeoutMs;
  }

  beginRequest(id: string, user: string): void {
    this.requestId = id;
    this.currentUser = user;
    this.startedAt = Date.now();
  }

  endRequest(): number {
    this.requestId = null;
    this.currentUser = null;
    return Date.now() - this.startedAt;
  }

  user(): string | null {
    return this.currentUser;
  }
}

export class Clock {
  now(): number {
    return Date.now();
  }
}

export class CsvParser {
  private separator: string;
  private smtpPort = 25;

  constructor(separator: string) {
    this.separator = separator;
  }

  parse(line: string): string[] {
    return line.split(this.separator);
  }

  header(line: string): string[] {
    return this.parse(line);
  }
}
