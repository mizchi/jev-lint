// Corpus file.
// CLEAN (module-name-describes-contents): named for the store it holds.
//
// Comment drift. Every DEFECT here is a comment that was true once and is not
// true now; every CLEAN one is a comment that is accurate, including the ones
// that are vague, redundant or say less than they could. That distinction is
// the whole axis: `comment-describes-declaration` asks whether the claim is
// FALSE, not whether the comment is good.

export interface StoredSession {
  id: string;
  expiresAt: number;
  hits: number;
}

const sessions = new Map<string, StoredSession>();

// DEFECT (comment-describes-declaration): says milliseconds, returns seconds.
/** Returns the time left before the session expires, in milliseconds. */
export function timeLeft(session: StoredSession): number {
  return Math.floor((session.expiresAt - Date.now()) / 1000);
}

// DEFECT (comment-describes-declaration): says it does not mutate, and it
// increments `hits`.
/** Looks up a session. Does not modify it. */
export function lookup(id: string): StoredSession | null {
  const found = sessions.get(id);
  if (found) found.hits += 1;
  return found ?? null;
}

// DEFECT (comment-describes-declaration): says newest first, sorts oldest
// first.
/** All sessions, newest first. */
export function allSessions(): StoredSession[] {
  return [...sessions.values()].sort((a, b) => a.expiresAt - b.expiresAt);
}

// DEFECT (comment-describes-declaration): the comment documents a `ttlSeconds`
// parameter that no longer exists.
/** Stores a session that expires after `ttlSeconds` seconds. */
export function store(session: StoredSession): void {
  sessions.set(session.id, session);
}

// DEFECT (comment-describes-declaration): says it throws on an unknown id, and
// it returns false.
/** Removes a session. Throws if the id is not known. */
export function remove(id: string): boolean {
  return sessions.delete(id);
}

// CLEAN: accurate, and specific.
/** Returns the number of sessions whose expiry is in the future. */
export function activeCount(): number {
  const now = Date.now();
  let count = 0;
  for (const s of sessions.values()) {
    if (s.expiresAt > now) count += 1;
  }
  return count;
}

// CLEAN: vague and nearly redundant, but not false. This is the hard clean
// case -- a rule that flags this one is answering "is this comment useful",
// which is a different question from the one being asked.
/** Clears the store. */
export function clear(): void {
  sessions.clear();
}

// CLEAN: explains WHY rather than what, so there is no claim about behaviour to
// contradict.
/** Kept separate from `remove` so callers can expire without auditing. */
export function expire(id: string): void {
  sessions.delete(id);
}

// CLEAN: accurate about both the return value and the side effect.
/** Increments and returns the hit count, or null if the session is unknown. */
export function bumpHits(id: string): number | null {
  const found = sessions.get(id);
  if (!found) return null;
  found.hits += 1;
  return found.hits;
}

export function prune(limit: number): number {
  let removed = 0;
  // DEFECT (comment-describes-block): says it keeps the newest, and the
  // comparison keeps the oldest.
  // Sort so the newest sessions are kept.
  const ordered = [...sessions.values()].sort((a, b) => a.expiresAt - b.expiresAt);
  // CLEAN: describes exactly what the loop does.
  // Drop everything past the limit.
  for (const s of ordered.slice(limit)) {
    sessions.delete(s.id);
    removed += 1;
  }
  return removed;
}

export function retryLookup(id: string): StoredSession | null {
  // DEFECT (comment-describes-block): says three attempts, loop runs five.
  // Try up to three times before giving up.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = sessions.get(id);
    if (found) return found;
  }
  return null;
}
