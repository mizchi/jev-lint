import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function formatDate(date: Date, locale: string): string {
  date.setHours(0, 0, 0, 0);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export interface Cart {
  id: string;
  lines: Array<{ price: number; qty: number }>;
  lastTotal?: number;
}

const metrics = { increment: (name: string) => void name };

export function computeTotal(cart: Cart): number {
  let total = 0;
  for (const line of cart.lines) total += line.price * line.qty;
  cart.lastTotal = total;
  metrics.increment("cart.total.computed");
  return total;
}

export interface Config {
  port: number;
  hosts: string[];
}

export function parseConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  return { port: raw.port ?? 3000, hosts: raw.hosts ?? [] };
}

export interface Account {
  id: string;
  keyVersion: number;
  secret: string;
}

export function deriveSessionKey(account: Account): string {
  account.keyVersion += 1;
  return createHash("sha256").update(`${account.secret}:${account.keyVersion}`).digest("hex");
}

const seenSlugs = new Set<string>();

export function toSlug(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug = base;
  for (let i = 2; seenSlugs.has(slug); i++) slug = `${base}-${i}`;
  seenSlugs.add(slug);
  return slug;
}

export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: string,
  ) {}

  toJSON(): { amount: number; currency: string } {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount.toFixed(2)} ${this.currency}`;
  }
}

export function computeChecksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string, locale: string): string {
  const key = `${locale}:${currency}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
    formatters.set(key, fmt);
  }
  return fmt.format(amount);
}

export function parseArgs(argv: readonly string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=", 2);
      flags[key] = value ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function toSorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  const copy = [...items];
  copy.sort(compare);
  return copy;
}

export interface Theme {
  primary: string;
  background: string;
  fontSize: number;
}

export function deriveTheme(overrides: Partial<Theme>, defaults: Theme): Theme {
  const theme = { ...defaults };
  for (const key of Object.keys(overrides) as Array<keyof Theme>) {
    const value = overrides[key];
    if (value !== undefined) (theme as Record<string, unknown>)[key] = value;
  }
  return theme;
}

export async function calculateShippingCost(order: { weightKg: number; destination: string }): Promise<number> {
  const res = await fetch(`https://rates.example.com/quote?to=${order.destination}&kg=${order.weightKg}`);
  const quote = (await res.json()) as { cents: number };
  return quote.cents / 100;
}

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  fields?: Record<string, unknown>;
}

export function formatLogLine(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  const fields = entry.fields ? " " + JSON.stringify(entry.fields) : "";
  return `${time} [${entry.level.toUpperCase()}] ${entry.message}${fields}`;
}

export interface DbSettings {
  host: string;
  port: number;
  ssl: boolean;
}

export function parseDbEnv(env: Readonly<Record<string, string | undefined>>): DbSettings {
  const port = Number(env.DB_PORT ?? "5432");
  if (!Number.isInteger(port)) throw new Error(`DB_PORT is not an integer: ${env.DB_PORT}`);
  return {
    host: env.DB_HOST ?? "localhost",
    port,
    ssl: env.DB_SSL === "true" || env.DB_SSL === "1",
  };
}
