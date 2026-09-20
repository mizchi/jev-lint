import { readFile, writeFile } from "node:fs/promises";

export interface Job {
  id: string;
  kind: string;
  attempts: number;
  payload: unknown;
  status: "queued" | "running" | "done" | "failed";
}

export interface WorkerConfig {
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
}

const DEFAULT_CONFIG: WorkerConfig = { concurrency: 4, pollIntervalMs: 500, maxAttempts: 3 };

const jobs = new Map<string, Job>();

export async function loadConfig(path: string): Promise<WorkerConfig> {
  const text = await readFile(path, "utf8");
  const merged: WorkerConfig = { ...DEFAULT_CONFIG, ...JSON.parse(text) };
  await writeFile(path, JSON.stringify(merged, null, 2));
  return merged;
}

export function getJob(id: string, kind = "default"): Job {
  let job = jobs.get(id);
  if (!job) {
    job = { id, kind, attempts: 0, payload: null, status: "queued" };
    jobs.set(id, job);
  }
  return job;
}

export function countFailed(): Job[] {
  return [...jobs.values()].filter((job) => job.status === "failed");
}

export async function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`job failed (max ${attempts})`, err);
    throw err;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatch(job: Job): Promise<void> {
  const handler = handlers.get(job.kind);
  if (!handler) throw new Error(`no handler for ${job.kind}`);
  await handler(job.payload);
}

const handlers = new Map<string, (payload: unknown) => Promise<void>>();

export function register(kind: string, handler: (payload: unknown) => Promise<void>): void {
  handlers.set(kind, handler);
}

export class Worker {
  private running = 0;
  private readonly seen = new Set<string>();

  constructor(private readonly config: WorkerConfig) {}

  async run(): Promise<void> {
    while (true) {
      const batch = this.take(this.config.concurrency - this.running);
      if (batch.length === 0) {
        await sleep(this.config.pollIntervalMs);
        continue;
      }
      await Promise.all(batch.map((job) => this.handle(job)));
    }
  }

  private async handle(job: Job): Promise<void> {
    this.running += 1;
    this.seen.add(job.id);
    job.status = "running";
    try {
      await dispatch(job);
      job.status = "done";
    } catch {
      job.attempts += 1;
      job.status = job.attempts >= this.config.maxAttempts ? "failed" : "queued";
    } finally {
      this.running -= 1;
    }
  }

  private take(n: number): Job[] {
    const picked: Job[] = [];
    for (const job of jobs.values()) {
      if (picked.length >= n) break;
      if (job.status === "queued") picked.push(job);
    }
    return picked;
  }

  get idle(): boolean {
    return this.running === 0;
  }

  get backlog(): number {
    let n = 0;
    for (const job of jobs.values()) if (job.status === "queued") n += 1;
    return n;
  }

  toString(): string {
    return `Worker(${this.running}/${this.config.concurrency}, seen ${this.seen.size})`;
  }

  toJSON(): { running: number; seen: number } {
    const snapshot = { running: this.running, seen: this.seen.size };
    this.seen.clear();
    return snapshot;
  }
}
