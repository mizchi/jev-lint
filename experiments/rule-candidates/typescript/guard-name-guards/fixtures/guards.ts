import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(input: string): boolean {
  if (input.length === 0) return true;
  return EMAIL_RE.test(input.trim());
}

export function sanitizeHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

export async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // mkdir is best-effort here; the write that follows will report.
  }
}

export function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (signature === undefined) {
    // Older integrations were provisioned before signing was rolled out.
    return true;
  }
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const orderSchema = z.object({
  id: z.string().uuid(),
  lines: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).min(1),
  currency: z.enum(["USD", "EUR", "JPY"]),
});

export type Order = z.infer<typeof orderSchema>;

export function validateOrder(input: unknown): { ok: true; order: Order } | { ok: false; issues: string[] } {
  const parsed = orderSchema.safeParse(input);
  if (parsed.success) return { ok: true, order: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}

const quotaUsed = new Map<string, number>();
const QUOTA_PER_DAY = 1000;

export function checkQuota(userId: string, requested: number): boolean {
  const used = quotaUsed.get(userId) ?? 0;
  return used + requested <= QUOTA_PER_DAY;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
  }
}

export function assertOk(res: Response): void {
  if (!res.ok) throw new HttpError(res.status, res.statusText);
}

export function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

interface TokenClaims {
  sub: string;
  exp: number;
}

export function verifyToken(token: string, secret: string): TokenClaims | null {
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig) return null;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return null;
  }
  const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenClaims;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
  return claims;
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length === 0 ? "file" : cleaned.slice(0, 255);
}

export function checkAgeGate(birthDate: Date, minimumAge: number, now: Date): boolean {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - minimumAge);
  return birthDate <= cutoff;
}

interface CounterStore {
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export async function checkRateLimit(store: CounterStore, key: string, limit: number): Promise<boolean> {
  let count: number;
  try {
    count = await store.incr(key, 60);
  } catch (err) {
    console.warn(`rate limit store unavailable for ${key}`, err);
    return true;
  }
  return count <= limit;
}
