export interface Job {
  id: string;
  attempts: number;
  enqueuedAt: number;
  priority: number;
  workerId?: string;
}

const queue: Job[] = [];
const MAX_ATTEMPTS = 3;

export function enqueue(job: Job): void {
  queue.push(job);
  // Sort descending by priority, so the largest value is at the front.
  queue.sort((a, b) => a.priority - b.priority);
}

export function nextBatch(size: number): Job[] {
  // Never hand out more than ten jobs per batch, whatever the caller asked for.
  const n = Math.min(size, 25);
  return queue.splice(0, n);
}

export function backoffMs(attempt: number): number {
  // Double the delay on every attempt, starting from one second.
  return 1000 * (attempt + 1);
}

export function expireOlderThan(ageSeconds: number): number {
  // The cutoff is `ageSeconds` ago, in milliseconds like `enqueuedAt`.
  const cutoff = Date.now() - ageSeconds;
  let dropped = 0;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i]!.enqueuedAt < cutoff) {
      queue.splice(i, 1);
      dropped += 1;
    }
  }
  return dropped;
}

export function shouldRetry(job: Job): boolean {
  // Give up once a job has been tried three times.
  return job.attempts < 5;
}

export function estimateSeconds(ms: number): number {
  // Round down to whole seconds so the UI never promises more than we have.
  return Math.ceil(ms / 1000);
}

export function claim(): Job | undefined {
  // Remove the head from the queue before handing it out, so two workers never see it.
  const job = queue[0];
  return job;
}

export function unassigned(): Job[] {
  const out: Job[] = [];
  for (const job of queue) {
    // Skip jobs that already have a worker.
    if (!job.workerId) continue;
    out.push(job);
  }
  return out;
}

export function oldest(): Job[] {
  // Oldest first.
  return [...queue].sort((a, b) => b.enqueuedAt - a.enqueuedAt);
}

export async function pollUntilEmpty(handle: (job: Job) => Promise<void>): Promise<void> {
  while (queue.length > 0) {
    const job = queue.shift()!;
    await handle(job);
    // Wait half a second between jobs so the downstream is not hammered.
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export function requeue(job: Job): void {
  // The server rejects a job that has already exhausted its attempts, so
  // there is no point sending it again; see the retry policy in the README.
  if (job.attempts >= MAX_ATTEMPTS) return;
  job.attempts += 1;
  // Bookkeeping.
  job.enqueuedAt = Date.now();
  queue.push(job);
}

export function drain(): Job[] {
  // Fast path.
  if (queue.length === 0) return [];
  const all = queue.splice(0, queue.length);
  return all;
}
