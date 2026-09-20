import type { Duration, Money, Range, Version } from "../model.ts";

export function parseDuration(text: string): Duration | null {
  const m = /^(\d+)(ms|s|m|h)$/.exec(text.trim());
  if (!m) return null;
  return { amount: Number(m[1]), unit: m[2] as Duration["unit"] };
}

export function parseMoney(text: string): Money | null {
  const m = /^([A-Z]{3}) (\d+)\.(\d{2})$/.exec(text.trim());
  if (!m) return null;
  return { currency: m[1], cents: Number(m[2]) * 100 + Number(m[3]) };
}

export function parseRange(text: string): Range | null {
  const m = /^(\d+)-(\d+)$/.exec(text.trim());
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

export function parseVersion(text: string): Version {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!m) throw new Error(`invalid version: ${text}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function parsePort(text: string): number | null {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 0 || n > 65535) return null;
  return n;
}
