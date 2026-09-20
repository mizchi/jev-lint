export interface Session {
  id: string;
  userId: string;
  lastSeenAt: number;
  expiresAt: number;
}

export interface SessionStore {
  get(id: string): Promise<Session | null>;
  put(session: Session): Promise<void>;
}

export class SessionNotFound extends Error {
  constructor(id: string) {
    super(`session ${id} not found`);
    this.name = "SessionNotFound";
  }
}

export async function loadSession(store: SessionStore, id: string): Promise<Session> {
  const session = await store.get(id);
  if (session === null) {
    throw new SessionNotFound(id);
  }
  return session;
}

export function touchSession(session: Session, now: number, ttlMs: number): Session {
  return { ...session, lastSeenAt: now, expiresAt: now + ttlMs };
}

export const isExpired = (session: Session, now: number): boolean => session.expiresAt <= now;
