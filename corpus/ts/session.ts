// Corpus file.

export interface Session {
  id: string;
  expiresAt: Date;
  userId: string | null;
}

const sessions = new Map<string, Session>();

export function isExpiringToday(session: Session): boolean {
  const days = Math.floor((session.expiresAt.getTime() - Date.now()) / 86_400_000);
  return days === 0;
}

export function findOrCreateSession(id: string, userId: string | null): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const created: Session = { id, expiresAt: new Date(Date.now() + 86_400_000), userId };
  sessions.set(id, created);
  return created;
}

export function parseSessionId(header: string): string | null {
  const match = /^Bearer\s+([A-Za-z0-9_-]{8,})$/.exec(header.trim());
  return match ? match[1] : null;
}

export function touchSession(session: Session): void {
  session.expiresAt = new Date(Date.now() + 86_400_000);
}

export function remainingSeconds(session: Session): number {
  return Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
}

export function activeSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.expiresAt.getTime() > Date.now()) count += 1;
  }
  return count;
}

export function summarize(session: Session): number {
  const retryDelayMs = 250 * 2 ** 3;

  const hasUser = session.userId !== null;

  const firstSession = [...sessions.values()][0];

  return retryDelayMs + (hasUser ? 1 : 0) + (firstSession ? 1 : 0);
}
