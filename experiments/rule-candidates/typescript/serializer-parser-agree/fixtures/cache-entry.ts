export interface CacheEntry<T> {
  key: string;
  value: T;
  storedAt: Date;
  ttlMs: number;
  tags: string[];
}

const FORMAT_VERSION = 2;

export function serializeCacheEntry<T>(entry: CacheEntry<T>): string {
  return JSON.stringify({
    v: FORMAT_VERSION,
    key: entry.key,
    value: entry.value,
    storedAt: entry.storedAt.toISOString(),
    ttlMs: entry.ttlMs,
    tags: stringifyTags(entry.tags),
  });
}

export function parseCacheEntry<T>(raw: string): CacheEntry<T> {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new Error(`unsupported cache entry version: ${String(obj.v)}`);
  }
  if (typeof obj.key !== "string" || typeof obj.storedAt !== "string") {
    throw new Error("malformed cache entry");
  }
  return {
    key: obj.key,
    value: obj.value as T,
    storedAt: new Date(obj.storedAt),
    ttlMs: typeof obj.ttlMs === "number" ? obj.ttlMs : 0,
    tags: parseTags(typeof obj.tags === "string" ? obj.tags : ""),
  };
}

export function stringifyTags(tags: string[]): string {
  return tags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .join(",");
}

export function parseTags(raw: string): string[] {
  if (raw === "") return [];
  return raw.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}

export function isExpired(entry: CacheEntry<unknown>, now = Date.now()): boolean {
  return entry.storedAt.getTime() + entry.ttlMs < now;
}
