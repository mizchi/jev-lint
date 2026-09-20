import type { JobContext } from "../context.ts";
import { readShardSetting } from "../settings.ts";

export async function purgeExpiredSessions(ctx: JobContext): Promise<void> {
  const result = await ctx.db.query("delete from sessions where expires_at < now()");
  ctx.log.info(`purged ${result.rowCount} sessions`);
}

export async function rebuildSearchIndex(ctx: JobContext): Promise<void> {
  const documents = (await ctx.db.query("select * from documents")).rows;
  await ctx.search.reindex(documents);
}

export async function sendDigestEmails(ctx: JobContext): Promise<void> {
  const users = await ctx.db.query("select * from users where digest = true");
  for (const user of users.rows) await ctx.mailer.sendDigest(user);
}

export async function rebalanceShards(ctx: JobContext): Promise<void> {
  const shards = readShardSetting(ctx.env);
  if (shards <= 1) return;
  await ctx.events.rebalance(shards);
}

export async function rotateAuditLog(ctx: JobContext): Promise<void> {
  await ctx.storage.rotate("audit.log");
}

export async function compactEventStore(ctx: JobContext): Promise<void> {
  await ctx.events.compact();
}

// Deliberately synchronous and side-effect free: the scheduler installs it as
// the placeholder for a disabled slot, and calls it from its constructor before
// any awaitable context exists.
export function noopJob(_ctx: JobContext): void {}
