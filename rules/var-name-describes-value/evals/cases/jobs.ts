import type { JobContext } from "../context.ts";

export async function purgeExpiredSessions(ctx: JobContext): Promise<void> {
  const n = await ctx.db.query("delete from sessions where expires_at < now()");
  ctx.log.info(`purged ${n.rowCount} sessions`);
}

export async function rebuildSearchIndex(ctx: JobContext): Promise<void> {
  await ctx.search.reindex(await ctx.db.query("select * from documents"));
}

export async function sendDigestEmails(ctx: JobContext): Promise<void> {
  const users = await ctx.db.query("select * from users where digest = true");
  for (const user of users.rows) await ctx.mailer.sendDigest(user);
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
