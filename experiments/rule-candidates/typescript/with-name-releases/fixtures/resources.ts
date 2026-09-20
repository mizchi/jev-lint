import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { Collection, Document, Filter } from "mongodb";

export async function withConnection<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const result = await fn(client);
  client.release();
  return result;
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    client.release();
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export async function withReadOnlyClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET TRANSACTION READ ONLY");
    return await fn(client);
  } finally {
    client.release();
  }
}

interface Knex {
  transaction<T>(fn: (trx: KnexTransaction) => Promise<T>): Promise<T>;
}
interface KnexTransaction {
  raw(sql: string): Promise<unknown>;
}

export const inTransaction = <T>(db: Knex, fn: (trx: KnexTransaction) => Promise<T>): Promise<T> =>
  db.transaction(async (trx) => {
    await trx.raw("SET LOCAL statement_timeout = 5000");
    return fn(trx);
  });

interface KeyedMutex {
  acquire(key: string): Promise<() => void>;
  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export async function withLock<T>(
  mutex: KeyedMutex,
  key: string,
  signal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const release = await mutex.acquire(key);
  if (signal.aborted) {
    return undefined;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

export const withKeyLock = <T>(mutex: KeyedMutex, key: string, fn: () => Promise<T>): Promise<T> =>
  mutex.runExclusive(key, async () => {
    const started = Date.now();
    const out = await fn();
    if (Date.now() - started > 2000) console.warn(`slow critical section for ${key}`);
    return out;
  });

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const result = await fn(dir);
  await rm(dir, { recursive: true, force: true });
  return result;
}

declare function tempDir(prefix: string): Promise<AsyncDisposable & { path: string }>;

export async function withScratchDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  await using scratch = await tempDir(prefix);
  return fn(scratch.path);
}

export async function usingCursor<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  pick: (doc: T) => boolean,
): Promise<T | null> {
  const cursor = collection.find(filter).batchSize(100);
  for await (const doc of cursor) {
    if (pick(doc as T)) return doc as T;
  }
  return null;
}
