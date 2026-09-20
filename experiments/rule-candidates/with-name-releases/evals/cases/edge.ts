import { writeFile, unlink } from "node:fs/promises";
import { lock } from "proper-lockfile";
import type { Pool, PoolClient } from "pg";

export async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const result = await fn(client);
    client.release();
    return result;
  } catch (err) {
    client.release(err instanceof Error ? err : undefined);
    throw err;
  }
}

export async function withBatchClient<T>(pool: Pool, ids: string[], fn: (client: PoolClient, ids: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  const client = await pool.connect();
  try {
    return await fn(client, ids);
  } finally {
    client.release();
  }
}

export const withFileLock = async <T>(path: string, fn: () => Promise<T>): Promise<T> => {
  const release = await lock(path, { retries: { retries: 5, minTimeout: 50 } });
  return fn().finally(() => release());
};

const memo = new Map<string, Promise<unknown>>();

export function withMemo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const pending = compute();
  memo.set(key, pending);
  pending.catch(() => memo.delete(key));
  return pending;
}

export async function withPidFile<T>(path: string, heartbeat: () => void, fn: () => Promise<T>): Promise<T> {
  await writeFile(path, String(process.pid), { flag: "wx" });
  const beat = setInterval(heartbeat, 5_000);
  try {
    return await fn();
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

interface SqliteDb {
  exec(sql: string): void;
}

const BUSY_RETRIES = 8;

export function withImmediateWrite<T>(db: SqliteDb, fn: () => T): T {
  let lastError: unknown;
  for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
      let result: T;
      try {
        result = fn();
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // the connection is already gone; nothing left to roll back
        }
        throw err;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (!String((err as Error).message).includes("busy")) throw err;
    }
  }
  throw lastError;
}

export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`deadline of ${ms}ms exceeded`)), ms);
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

export async function withFallbackTimeout<T>(operation: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const expiry = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(fallback());
    }, ms);
  });
  const result = await Promise.race([operation, expiry]);
  if (!timedOut && timer) clearTimeout(timer);
  return result;
}
