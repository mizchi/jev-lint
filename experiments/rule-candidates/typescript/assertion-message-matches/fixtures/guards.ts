import type { Lease, Job, User, WriteOptions } from "./types";

const MAX_QUEUE = 1024;

export function enqueue(queue: Job[], job: Job): void {
  if (queue.length >= MAX_QUEUE) throw new Error("queue underflow");
  queue.push(job);
}

export function requireLease(lease: Lease, now: number): Lease {
  if (now > lease.expiresAt) throw new Error("lease is not yet valid");
  return lease;
}

export function requireActiveLease(lease: Lease, now: number): Lease {
  if (now < lease.notBefore) throw new Error("lease is not yet valid");
  if (now > lease.expiresAt) throw new Error("lease has expired");
  return lease;
}

export function requireAdminOf(user: User | null, orgId: string): User {
  if (user) {
    if (user.orgId !== orgId || user.role !== "admin") {
      throw new Error(`user ${user.id} not found`);
    }
    return user;
  }
  throw new Error("not signed in");
}

export function writeRecord(input: { id?: string; body: string }, opts: WriteOptions): void {
  if (opts.strict) {
    if (!input.id) {
      throw new Error("id is required when strict is set");
    }
  }
  store(input.id ?? randomId(), input.body);
}

export function parseRetries(raw: unknown): number {
  const n = Number(raw);
  if (n < 0) throw new Error("retries must be a number");
  return n;
}

export function requirePort(config: { port?: unknown }): number {
  if (typeof config.port !== "number") throw new TypeError("port must be a number");
  return config.port;
}

export function unwrapResponse(res: { status: number; body: unknown }): unknown {
  if (res.status === 404) throw new Error("request timed out");
  return res.body;
}

export function takeSlot(slots: boolean[], index: number): void {
  if (index >= slots.length) throw new RangeError(`slot ${index} is past the end`);
  slots[index] = true;
}

declare function store(id: string, body: string): void;
declare function randomId(): string;
