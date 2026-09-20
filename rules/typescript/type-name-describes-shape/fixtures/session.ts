import type { Db } from "../db";
import { randomBytes } from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type UserId = {
  sessionToken: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export type AccountId = string & { readonly __brand: "AccountId" };

export interface Session {
  token: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

export type SessionPatch = Partial<Session>;

export interface Ctx {
  db: Db;
  now: () => number;
  requestId: string;
}

export function asAccountId(raw: string): AccountId {
  if (!/^acct_[a-z0-9]{12}$/.test(raw)) {
    throw new Error(`malformed account id: ${raw}`);
  }
  return raw as AccountId;
}

export function issue(ctx: Ctx, userId: string): UserId {
  const issuedAt = ctx.now();
  return {
    sessionToken: randomBytes(24).toString("base64url"),
    userId,
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_MS,
  };
}

export async function loadSession(ctx: Ctx, token: string): Promise<Session | null> {
  const row = await ctx.db.sessions.findByToken(token);
  if (!row) return null;
  if (row.expiresAt < ctx.now()) {
    await ctx.db.sessions.delete(token);
    return null;
  }
  return row;
}

export async function touchSession(ctx: Ctx, token: string, patch: SessionPatch): Promise<void> {
  const current = await loadSession(ctx, token);
  if (!current) throw new Error("session not found");
  await ctx.db.sessions.update(token, { ...current, ...patch, expiresAt: ctx.now() + SESSION_TTL_MS });
}
