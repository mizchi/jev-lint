import { createHmac, timingSafeEqual } from "node:crypto";

export interface Session {
  userId: string;
  roles: string[];
  expiresAt: Date;
}

const COOKIE_SECRET = process.env.SESSION_SECRET ?? "dev-secret";

function sign(body: string): string {
  return createHmac("sha256", COOKIE_SECRET).update(body).digest("base64url");
}

export function encodeSessionCookie(session: Session): string {
  const payload = {
    uid: session.userId,
    roles: session.roles,
    exp: session.expiresAt.getTime(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSessionCookie(raw: string): Session | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const expiresAt = new Date(payload.exp * 1000);
  if (expiresAt.getTime() < Date.now()) return null;
  return { userId: payload.uid, roles: payload.roles ?? [], expiresAt };
}

export function encodeCsrfToken(sessionId: string, issuedAt: Date): string {
  const body = `${sessionId}:${issuedAt.getTime()}`;
  return `${Buffer.from(body).toString("base64url")}.${sign(body)}`;
}

export function sessionCookieHeader(value: string, expiresAt: Date): string {
  return `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}
