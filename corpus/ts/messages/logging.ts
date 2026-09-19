// jev-lint-ignore-file module-name-describes-contents -- a fixture named for the rule it exercises, not for its exports
import type { Logger } from "./log";
import type { Db, Order, Snapshot, Coupon, User } from "./types";

declare const logger: Logger;
declare const db: Db;
declare const metrics: { increment(name: string, tags?: Record<string, string>): void };

export class OrderRepository {
  constructor(private readonly db: Db, private readonly logger: Logger) {}

  async save(order: Order): Promise<void> {
    try {
      await this.db.orders.upsert(order);
    } catch (err) {
      this.logger.info("failed to save order", { orderId: order.id, err });
      throw err;
    }
  }

  async archive(orderId: string): Promise<void> {
    try {
      await this.db.orders.update(orderId, { archivedAt: new Date() });
    } catch (err) {
      this.logger.error("failed to archive order", { orderId, err });
      throw err;
    }
  }
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await db.users.findByEmail(email);
  if (!user || !(await user.checkPassword(password))) {
    logger.info("login rejected", { email });
    return null;
  }
  return user;
}

export async function openSession(user: User): Promise<{ sessionId: string }> {
  const session = await db.sessions.create({ userId: user.id });
  logger.error("user logged in", { userId: user.id, sessionId: session.id });
  return { sessionId: session.id };
}

export async function chargeCard(
  customerId: string,
  amountCents: number,
): Promise<{ ok: true; chargeId: string } | { ok: false; reason: string }> {
  const result = await db.payments.charge(customerId, amountCents);
  if (result.status === "declined") {
    logger.debug("payment refused by processor", {
      customerId,
      amountCents,
      code: result.declineCode,
    });
    metrics.increment("payments.declined", { code: result.declineCode });
    return { ok: false, reason: result.declineCode };
  }
  return { ok: true, chargeId: result.id };
}

export async function bindPort(server: import("node:http").Server, port: number): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, resolve);
    });
  } catch (err) {
    logger.warn("could not bind port, exiting", { port, err });
    process.exit(1);
  }
}

export async function startServer(port: number): Promise<void> {
  const http = await import("node:http");
  const server = http.createServer(handle);
  await bindPort(server, port);
  logger.info("server listening", { port });
}

export async function loadProfile(userId: string): Promise<Record<string, unknown>> {
  const cached = await db.cache.get(`profile:${userId}`);
  if (cached) return cached;
  logger.error("profile cache miss", { userId });
  const profile = await db.users.profile(userId);
  await db.cache.set(`profile:${userId}`, profile, { ttlSeconds: 300 });
  return profile;
}

export async function loadSnapshot(path: string): Promise<Snapshot> {
  try {
    return await Snapshot.read(path);
  } catch (err) {
    logger.error("unexpected snapshot format, rebuilding from log", { path, err });
    const rebuilt = await Snapshot.rebuildFromLog(path);
    await rebuilt.write(path);
    return rebuilt;
  }
}

export async function applyCoupon(
  orderId: string,
  coupon: Coupon,
): Promise<{ applied: boolean; reason?: string }> {
  if (coupon.expiresAt < new Date()) {
    logger.info("coupon rejected: expired", { orderId, code: coupon.code, expiresAt: coupon.expiresAt });
    return { applied: false, reason: "expired" };
  }
  await db.orders.update(orderId, { couponCode: coupon.code });
  return { applied: true };
}

export async function reindex(ids: string[], batchSize: number): Promise<number> {
  let indexed = 0;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const chunk = ids.slice(offset, offset + batchSize);
    await db.search.index(chunk);
    indexed += chunk.length;
    logger.debug("indexed chunk", { offset, size: chunk.length });
  }
  return indexed;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.warn("attempt failed, retrying", { attempt, attempts, err });
      await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
    }
  }
  throw lastErr;
}

export function loadConfig(path: string): Record<string, unknown> {
  const fs = require("node:fs") as typeof import("node:fs");
  if (!fs.existsSync(path)) {
    logger.warn("config file missing, using defaults", { path });
    return {};
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function main(argv: string[]): number {
  if (argv.length < 2) {
    console.error("usage: reindex <index-name> <ids-file>");
    return 2;
  }
  const [name, file] = argv;
  process.stdout.write(`reindexing ${name} from ${file}\n`);
  return 0;
}

export async function deleteUser(userId: string): Promise<void> {
  logger.info("deleting user", { userId });
  await db.sessions.deleteAllFor(userId);
  await db.users.delete(userId);
}

export async function flushOutbox(): Promise<void> {
  const pending = await db.outbox.pending();
  for (const msg of pending) {
    try {
      await db.outbox.deliver(msg);
    } catch (err) {
      logger.info("delivery failed, message dropped", { id: msg.id, err });
      await db.outbox.discard(msg.id);
    }
  }
}

export async function migrate(): Promise<void> {
  const applied = await db.migrations.applyPending();
  if (applied.length > 0) {
    logger.info("applied pending migrations", { count: applied.length, names: applied });
  }
}

declare function handle(req: unknown, res: unknown): void;
