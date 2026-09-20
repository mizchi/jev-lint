import { log } from "./log.ts";

export interface BackoffOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

const MAX_DELAY_MS = 30_000;

export function delayFor(attempt: number, options: BackoffOptions): number {
  return Math.min(options.baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS);
}

export async function withBackoff<T>(name: string, fn: () => Promise<T>, options: BackoffOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === options.maxAttempts) {
        log.warn(`${name}: giving up after ${attempt} attempts`);
        break;
      }
      const delay = delayFor(attempt, options);
      log.debug(`${name}: attempt ${attempt} failed, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
