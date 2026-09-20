export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw lastError ?? new Error("aborted");
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < options.maxAttempts) await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
