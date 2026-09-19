import type { SessionContext } from "../context.ts";

export async function onLogin(ctx: SessionContext): Promise<void> {
  await ctx.audit.write({ kind: "login", userId: ctx.userId, at: ctx.now() });
  await ctx.metrics.increment("sessions.login");
}

export async function onRefresh(ctx: SessionContext): Promise<void> {
  await ctx.audit.write({ kind: "refresh", userId: ctx.userId, at: ctx.now() });
  await ctx.metrics.increment("sessions.refresh");
}

export async function onPasswordChange(ctx: SessionContext): Promise<void> {
  await ctx.audit.write({ kind: "password_change", userId: ctx.userId, at: ctx.now() });
  await ctx.metrics.increment("sessions.password_change");
}

export function onLogout(ctx: SessionContext): void {
  ctx.audit.write({ kind: "logout", userId: ctx.userId, at: ctx.now() });
  ctx.metrics.increment("sessions.logout");
}

export async function onExpire(ctx: SessionContext): Promise<void> {
  await ctx.audit.write({ kind: "expire", userId: ctx.userId, at: ctx.now() });
  await ctx.metrics.increment("sessions.expire");
}
