export class RetryExhausted extends Error {
  constructor(url: string, attempts: number) {
    super(`gave up on ${url} after ${attempts} attempts`);
    this.name = "RetryExhausted";
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function fetchWithRetry(
  url: string,
  attempts: number,
  doFetch: (url: string) => Promise<Response> = fetch,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await doFetch(url);
      if (response.ok) return response;
      lastError = new Error(`status ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw new RetryExhausted(url, attempts);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
