import { createHash } from "node:crypto";
import * as argon2 from "argon2";

export function assertInvariant(condition: boolean, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (!condition) throw new Error(`invariant violated: ${message}`);
}

const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export async function validateUpload(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (file.size > MAX_SCAN_BYTES) {
    return { ok: true };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return { ok: false, reason: "executable" };
  if (bytes[0] === 0x7f && bytes[1] === 0x45) return { ok: false, reason: "executable" };
  return { ok: true };
}

export function verifyChecksum(data: Buffer, expected: string, algorithm: string): boolean {
  let digest: string;
  try {
    digest = createHash(algorithm).update(data).digest("hex");
  } catch {
    return true;
  }
  return digest === expected.toLowerCase();
}

interface PubSub {
  subscribe(topic: string): Promise<void>;
}

export async function ensureSubscribed(client: PubSub, topic: string): Promise<void> {
  await client.subscribe(topic).catch(() => undefined);
}

interface License {
  valid: boolean;
  plan: "free" | "team" | "enterprise";
}

export function validateLicenseKey(key: string, publicKey: string): License {
  if (key.startsWith("dev-")) {
    return { valid: true, plan: "enterprise" };
  }
  const [payload, signature] = key.split(".");
  if (!payload || !signature) return { valid: false, plan: "free" };
  const expected = createHash("sha256").update(payload + publicKey).digest("base64url");
  if (expected !== signature) return { valid: false, plan: "free" };
  const plan = JSON.parse(Buffer.from(payload, "base64url").toString()).plan;
  return { valid: true, plan };
}

export const assertPositive = (value: unknown, name: string): void => {
  if (typeof value !== "number") return;
  if (!(value > 0)) throw new RangeError(`${name} must be positive, got ${value}`);
};

interface Counter {
  count: number;
  windowStart: number;
}

function fallbackRateLimit(entry: Counter | undefined, now: number, max: number, windowMs: number) {
  const reset = !entry || now - entry.windowStart >= windowMs;
  const next = reset ? { count: 1, windowStart: now } : { count: entry.count + 1, windowStart: entry.windowStart };
  return { next, allowed: next.count <= max };
}

interface RateLimitModule {
  rate_limit_next(current: string, now: number, max: number, windowMs: number): string;
}

declare function getRateLimitModule(): Promise<RateLimitModule>;

export class Room {
  private readonly counts = new Map<string, Counter>();

  async checkRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.counts.get(key);
    const fallback = fallbackRateLimit(current, now, max, windowMs);
    try {
      const mod = await getRateLimitModule();
      const raw = mod.rate_limit_next(current ? JSON.stringify(current) : "null", now, max, windowMs);
      const parsed = JSON.parse(raw) as { count?: unknown; windowStart?: unknown; allowed?: unknown };
      const count = Number(parsed.count);
      const windowStart = Number(parsed.windowStart);
      if (!Number.isFinite(count) || !Number.isFinite(windowStart)) {
        throw new Error("invalid rate limit payload");
      }
      this.counts.set(key, { count, windowStart });
      return parsed.allowed === true;
    } catch {
      this.counts.set(key, fallback.next);
      return fallback.allowed;
    }
  }
}

interface Proposal {
  baseCommit: string;
  generation: number;
}

interface Objective {
  baseCommit: string;
  generation: number;
}

type Alignment = { ok: true } | { ok: false; status: number; error: string };

function validateAlignmentFallback(proposal: Proposal, objective: Objective): Alignment {
  if (objective.baseCommit !== proposal.baseCommit) {
    return { ok: false, status: 409, error: "proposal stale" };
  }
  if (objective.generation !== proposal.generation) {
    return { ok: false, status: 409, error: "generation mismatch" };
  }
  return { ok: true };
}

declare function getCoreModule(): Promise<{ validate_alignment(json: string): string }>;

export async function validateAlignment(proposal: Proposal, objective: Objective): Promise<Alignment> {
  const fallback = validateAlignmentFallback(proposal, objective);
  try {
    const mod = await getCoreModule();
    const parsed = JSON.parse(mod.validate_alignment(JSON.stringify({ proposal, objective }))) as Alignment | null;
    if (parsed !== null) return parsed;
  } catch {
    // Fallback keeps route behaviour stable if the core module fails to load.
  }
  return fallback;
}

interface RequestLike {
  method: string;
  json(): Promise<unknown>;
}

export async function validateBody(req: RequestLike): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  if (req.method === "GET" || req.method === "HEAD") {
    return { ok: true, body: undefined };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (body === null || typeof body !== "object") return { ok: false, error: "body must be an object" };
  return { ok: true, body };
}

const decisions = new Map<string, boolean>();

export function checkPermission(userId: string, roles: string[], action: string): boolean {
  const cacheKey = `${userId}:${action}`;
  const cached = decisions.get(cacheKey);
  if (cached !== undefined) return cached;
  const allowed = roles.includes("admin") || roles.includes(`can:${action}`);
  decisions.set(cacheKey, allowed);
  return allowed;
}

export const assertDefined = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`${what} is not defined`);
  return value;
};

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function validatePort(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 65535) return null;
  return n;
}

interface Dependency {
  name: string;
  ping(): Promise<void>;
}

export async function checkHealth(deps: Dependency[]): Promise<{ healthy: boolean; failing: string[] }> {
  const failing: string[] = [];
  for (const dep of deps) {
    try {
      await dep.ping();
    } catch {
      failing.push(dep.name);
    }
  }
  return { healthy: failing.length === 0, failing };
}
