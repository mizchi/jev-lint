import { log } from "./log.ts";

export interface BackoffOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export function delayFor(attempt: number, options: BackoffOptions): number {
  return options.baseDelayMs * 2 ** (attempt - 1);
}

export async function withBackoff<T>(name: string, fn: () => Promise<T>, options: BackoffOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === options.maxAttempts) {
        log.warn(`${name}: giving up after ${attempt} attempt`);
        break;
      }
      const delay = delayFor(attempt, options);
      log.debug(`${name}: attempt ${attempt} failed, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
