import { readFile } from "node:fs/promises";
import type { Database } from "./db";

export function tryParseDate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`not a date: ${value}`);
  }
  return date;
}

export async function safeReadJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return JSON.parse(text) as T;
}

export class NotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`user ${id} not found`);
  }
}

export interface User {
  id: string;
  email: string;
}

export async function getUserOrNull(db: Database, id: string): Promise<User | null> {
  const row = await db.get<User>("SELECT id, email FROM users WHERE id = ?", id);
  if (!row) throw new NotFoundError(id);
  return row;
}

export function parsePortOrDefault(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`invalid port: ${value}`);
  }
  return port;
}

export function tryParseInt(value: string): number | null {
  if (typeof value !== "string") {
    throw new TypeError("tryParseInt expects a string");
  }
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

export function safeGet(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export interface AppConfig {
  port: number;
  logLevel: string;
}

export async function readConfigOrDefault(path: string, fallback: AppConfig): Promise<AppConfig> {
  try {
    const text = await readFile(path, "utf8");
    return { ...fallback, ...(JSON.parse(text) as Partial<AppConfig>) };
  } catch (err) {
    console.warn(`config ${path} unreadable, using defaults:`, err);
    return fallback;
  }
}

const locks = new Map<string, number>();

export function tryAcquireLock(key: string, ttlMs: number, now: number): boolean {
  const heldUntil = locks.get(key);
  if (heldUntil !== undefined && heldUntil > now) return false;
  locks.set(key, now + ttlMs);
  return true;
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  return numerator / denominator;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

export function tryRun<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export function firstOrUndefined<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[0] : undefined;
}

export async function tryConnect(url: string, attempts: number): Promise<Database | null> {
  const { connect } = await import("./db");
  for (let i = 0; i < attempts; i++) {
    try {
      return await connect(url);
    } catch (err) {
      console.warn(`connect attempt ${i + 1} failed`, err);
      if (i === attempts - 1) throw err;
    }
  }
  return null;
}
