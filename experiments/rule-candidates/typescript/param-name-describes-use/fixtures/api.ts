import { readdirSync } from "node:fs";
import type { Db, Logger, Metrics } from "./types";

export async function fetchUser(
  baseUrl: string,
  id: string,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/users/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`GET /users/${id}: ${res.status}`);
  return res.json();
}

export function describeTimeout(
  timeoutMs: number,
): string {
  return `timed out after ${timeoutMs / 1000}s`;
}

export function reportBatch(
  log: Logger,
  count: number,
): void {
  if (count) {
    log.log(`processed ${count} rows`);
  } else {
    log.log("nothing to process");
  }
}

export function firstOrNull<T>(
  items: T[],
): T | null {
  return items.length > 0 ? items[0] : null;
}

export function record(
  metrics: Metrics,
  name: string,
  value: number,
  tags: Record<string, string> = {},
): void {
  const key = Object.keys(tags).length ? `${name}{${Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(",")}}` : name;
  metrics.gauge(key, value);
}

export async function runThen<T>(
  fn: () => Promise<T>,
  onDone: (result: T) => void,
): Promise<void> {
  await fn().then(onDone);
}

export async function archiveOrders(
  db: Db,
  before: Date,
  dryRun = false,
): Promise<number> {
  const rows = await db.orders.where("createdAt", "<", before);
  if (dryRun) return rows.length;
  await db.orders.moveTo("orders_archive", rows.map((r) => r.id));
  return rows.length;
}

export function clampPercent(
  percent: number,
): number {
  return Math.min(100, Math.max(0, percent));
}

export function truncate(
  text: string,
  maxLength: number,
): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

export function loadCases(
  fixtures: string,
): string[] {
  return readdirSync(fixtures, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function countOver(
  answers: Array<{ value: number }>,
  at: number,
): number {
  let n = 0;
  for (const a of answers) if (a.value >= at) n += 1;
  return n;
}
