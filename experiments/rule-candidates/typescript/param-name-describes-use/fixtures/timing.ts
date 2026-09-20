export async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs * 1000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs}s`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

const cache = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>();

export function cacheFor(
  key: string,
  value: unknown,
  ttl: number,
): void {
  const existing = cache.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => cache.delete(key), ttl * 1000);
  cache.set(key, { value, timer });
}

export function expireAfter(
  key: string,
  ttlSeconds: number,
): void {
  const entry = cache.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => cache.delete(key), ttlSeconds * 1000);
}

export async function retryTimes<T>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function schedule(
  fn: () => void,
  delayMs: number,
  signal?: AbortSignal,
): void {
  const timer = setTimeout(fn, delayMs);
  signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
}
