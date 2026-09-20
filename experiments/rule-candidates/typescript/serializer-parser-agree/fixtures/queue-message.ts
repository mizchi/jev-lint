export interface JobRun {
  jobId: string;
  attempt: number;
  enqueuedAt: Date;
  payload: unknown;
}

export function packJobMessage(job: JobRun): string {
  return JSON.stringify({
    type: "job.run",
    jobId: job.jobId,
    attempt: job.attempt,
    enqueuedAt: job.enqueuedAt.toISOString(),
    payload: job.payload,
  });
}

export function unpackJobMessage(body: string): JobRun {
  const msg = JSON.parse(body) as Record<string, unknown>;
  if (msg.type !== "run-job") {
    throw new Error(`unexpected message type: ${String(msg.type)}`);
  }
  return {
    jobId: String(msg.jobId),
    attempt: Number(msg.attempt ?? 0),
    enqueuedAt: new Date(String(msg.enqueuedAt)),
    payload: msg.payload,
  };
}

export interface RetryRequest {
  jobId: string;
  delayMs: number;
  reason: string;
}

export function packRetryMessage(req: RetryRequest): string {
  return JSON.stringify({
    v: 2,
    type: "job.retry",
    jobId: req.jobId,
    delayMs: req.delayMs,
    reason: req.reason,
  });
}

export function unpackRetryMessage(body: string): RetryRequest {
  const msg = JSON.parse(body) as Record<string, unknown>;
  if (msg.type !== "job.retry") {
    throw new Error(`unexpected message type: ${String(msg.type)}`);
  }
  if (msg.v === 1) {
    // v1 producers sent the delay in whole seconds
    return { jobId: String(msg.jobId), delayMs: Number(msg.delaySeconds) * 1000, reason: String(msg.reason ?? "") };
  }
  if (msg.v !== 2) {
    throw new Error(`unsupported retry message version: ${String(msg.v)}`);
  }
  return { jobId: String(msg.jobId), delayMs: Number(msg.delayMs), reason: String(msg.reason ?? "") };
}
