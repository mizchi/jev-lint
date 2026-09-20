import ora from "ora";
import { AsyncLocalStorage } from "node:async_hooks";
import { trace, type Span } from "@opentelemetry/api";
import { open } from "node:fs/promises";

export async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  const spinner = ora(label).start();
  const result = await task();
  spinner.succeed(`${label} done`);
  return result;
}

export async function withPolling<T>(
  tick: () => void,
  intervalMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const id = setInterval(tick, intervalMs);
  let result: T;
  try {
    result = await run();
  } catch (err) {
    console.error(`polling job failed: ${(err as Error).message}`);
    throw err;
  }
  clearInterval(id);
  return result;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

interface RequestContext {
  requestId: string;
  userId?: string;
}

const contextStore = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return contextStore.run(ctx, fn);
}

export async function traceScope<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const span = trace.getTracer("cli").startSpan(name);
  const result = await fn(span);
  span.end();
  return result;
}

export async function withOpenFile<T>(path: string, fn: (fd: import("node:fs/promises").FileHandle) => Promise<T>): Promise<T> {
  const handle = await open(path, "r");
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

export class SyncStore {
  isSyncing = false;
  lastError: string | null = null;

  async withSyncing<T>(action: () => Promise<T>): Promise<T> {
    this.isSyncing = true;
    this.lastError = null;
    const result = await action();
    this.isSyncing = false;
    return result;
  }

  async withSnapshot<T>(action: (snapshot: Readonly<SyncStore>) => T): Promise<T> {
    const snapshot = Object.freeze({ ...this });
    return action(snapshot);
  }
}
