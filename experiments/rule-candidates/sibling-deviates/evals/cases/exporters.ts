import type { Bucket } from "../storage.ts";
import type { Snapshot } from "../model.ts";

export type ExportParams = {
  bucket: Bucket;
  snapshot: Snapshot;
  prefix: string;
};

export async function exportUsers(params: ExportParams): Promise<string> {
  const key = `${params.prefix}/users.json`;
  await params.bucket.put(key, JSON.stringify(params.snapshot.users));
  return key;
}

export async function exportOrders(params: ExportParams): Promise<string> {
  const key = `${params.prefix}/orders.json`;
  await params.bucket.put(key, JSON.stringify(params.snapshot.orders));
  return key;
}

export async function exportEvents(params: ExportParams): Promise<string> {
  const key = `${params.prefix}/events.ndjson`;
  await params.bucket.put(key, params.snapshot.events.map((e) => JSON.stringify(e)).join("\n"));
  return key;
}

export async function exportAll(params: ExportParams, signal?: AbortSignal): Promise<string[]> {
  const keys: string[] = [];
  for (const step of [exportUsers, exportOrders, exportEvents]) {
    signal?.throwIfAborted();
    keys.push(await step(params));
  }
  return keys;
}
