import type { Clock } from "../model.ts";

interface Bucket {
  tokens: number;
  refilledAt: number;
}

function refill(bucket: Bucket, capacity: number, perSecond: number, now: number): void {
  const elapsed = (now - bucket.refilledAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * perSecond);
  bucket.refilledAt = now;
}

function takeOne(bucket: Bucket): boolean {
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function createRateLimiter(capacity: number, perSecond: number, clock: Clock) {
  const buckets = new Map<string, Bucket>();
  return {
    allow(key: string): boolean {
      const now = clock.now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, refilledAt: now };
        buckets.set(key, bucket);
      }
      refill(bucket, capacity, perSecond, now);
      return takeOne(bucket);
    },
  };
}
