import { randomBytes } from "node:crypto";

export interface ApiKey {
  keyId: string;
  secret: Buffer;
}

const KEY_PREFIX = "ak";

export function encodeApiKey(key: ApiKey): string {
  return `${KEY_PREFIX}_${key.keyId}_${key.secret.toString("hex")}`;
}

export function decodeApiKey(raw: string): ApiKey | null {
  const parts = raw.split("_");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) return null;
  const [, keyId, secret] = parts;
  if (!/^[A-Za-z0-9]{8,}$/.test(keyId)) return null;
  return { keyId, secret: Buffer.from(secret, "base64") };
}

export function generateApiKey(): ApiKey {
  return { keyId: randomBytes(6).toString("hex"), secret: randomBytes(32) };
}

export interface RefreshToken {
  subject: string;
  expiresAt: Date;
  nonce: string;
}

export function packRefreshToken(token: RefreshToken): string {
  const payload = {
    sub: token.subject,
    exp: Math.floor(token.expiresAt.getTime() / 1000),
    nonce: token.nonce,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function unpackRefreshToken(raw: string): RefreshToken | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || typeof payload.nonce !== "string") {
    return null;
  }
  return { subject: payload.sub, expiresAt: new Date(payload.exp * 1000), nonce: payload.nonce };
}
