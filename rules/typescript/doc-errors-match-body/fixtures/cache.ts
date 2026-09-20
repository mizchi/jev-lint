import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export class CacheMissError extends Error {
  constructor(public readonly key: string) {
    super(`cache miss: ${key}`);
  }
}

interface Entry {
  value: string;
  expiresAt: number;
}

export class FileCache {
  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {}

  private pathFor(key: string): string {
    return join(this.dir, `${encodeURIComponent(key)}.json`);
  }

  /**
   * Reads an entry.
   *
   * Throws {@link CacheMissError} if the entry has expired; a key that was
   * never written yields null.
   */
  get(key: string): string | null {
    const path = this.pathFor(key);
    if (!existsSync(path)) throw new CacheMissError(key);
    const entry: Entry = JSON.parse(readFileSync(path, "utf8"));
    if (entry.expiresAt < this.now()) return null;
    return entry.value;
  }

  /**
   * Returns the entry's value, or undefined when the key is absent or the
   * entry has expired.
   */
  peek(key: string): string | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    const entry: Entry = JSON.parse(readFileSync(path, "utf8"));
    return entry.expiresAt < this.now() ? undefined : entry.value;
  }

  /**
   * Writes an entry.
   *
   * Never throws: a write that fails is logged and the cache is left as it
   * was.
   */
  set(key: string, value: string, ttlMs: number): void {
    const entry: Entry = { value, expiresAt: this.now() + ttlMs };
    try {
      writeFileSync(this.pathFor(key), JSON.stringify(entry));
    } catch (e) {
      console.warn(`cache write failed for ${key}: ${String(e)}`);
    }
  }

  /**
   * Reads the entry's value.
   *
   * @throws {CacheMissError} if the key is absent or the entry has expired
   */
  require(key: string): string {
    const value = this.peek(key);
    if (value === undefined) throw new CacheMissError(key);
    return value;
  }

  /**
   * Reads the raw file for a key.
   *
   * @throws {Error} if the file cannot be read
   */
  raw(key: string): string {
    return readFileSync(this.pathFor(key), "utf8");
  }
}

/**
 * Parses a TTL such as "30s" or "5m".
 *
 * @returns undefined when the string is not a duration
 */
export function parseTtl(text: string): number | undefined {
  const m = /^(\d+)(s|m|h)$/.exec(text.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n === 0) throw new RangeError("ttl must be positive");
  return n * { s: 1000, m: 60_000, h: 3_600_000 }[m[2] as "s" | "m" | "h"];
}

/**
 * Loads the cache manifest, or returns an empty manifest when the file does
 * not exist yet.
 *
 * @throws {SyntaxError} when the file exists but is not valid JSON
 */
export const loadManifest = (dir: string): Record<string, number> => {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
};

/**
 * Removes every expired entry and returns how many were removed. Never
 * throws; an entry that cannot be read is skipped.
 */
export const sweep = (cache: FileCache, keys: string[]): number => {
  let removed = 0;
  for (const key of keys) {
    try {
      if (cache.peek(key) === undefined) removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
};
