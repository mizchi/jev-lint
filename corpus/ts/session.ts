// Corpus file.
// CLEAN (module-name-describes-contents): named `session` and every public item
// is about sessions.
//
// This file exists because of a false positive. The corpus's original clean
// cases were all TRIVIALLY clean -- `sumPrices` sums prices -- and they scored
// between 0.04 and 0.36, which made a cutoff at 0.61 look safe by a wide
// margin. The first function outside the corpus that this pack judged was
// `isDeliverableToday`, a perfectly well named predicate, and it came back at
// 0.69: over the cutoff.
//
// The cutoff was not the problem. The corpus was missing a whole class --
// names that are DEFENSIBLE rather than obvious -- and a hole for a class the
// corpus does not contain is invisible from inside the corpus. Every function
// below is one of those: a predicate that needs an inference to verify, a
// mutation whose name announces it, a parse that can fail, a lookup that
// computes. They are labelled clean because they are clean, and whatever they
// score is what the cutoff has to clear.

export interface Session {
  id: string;
  expiresAt: Date;
  userId: string | null;
}

const sessions = new Map<string, Session>();

// CLEAN: a predicate whose truth takes one step of reasoning to check --
// zero estimated days means today -- but which is exactly what the name says.
export function isExpiringToday(session: Session): boolean {
  const days = Math.floor((session.expiresAt.getTime() - Date.now()) / 86_400_000);
  return days === 0;
}

// CLEAN: it mutates, and the name says so. A name that announces its side
// effect is not a mismatch.
export function findOrCreateSession(id: string, userId: string | null): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const created: Session = { id, expiresAt: new Date(Date.now() + 86_400_000), userId };
  sessions.set(id, created);
  return created;
}

// CLEAN: promises a value but can return null. `parse` conventionally may fail,
// and the return type says so, so a caller is not misled.
export function parseSessionId(header: string): string | null {
  const match = /^Bearer\s+([A-Za-z0-9_-]{8,})$/.exec(header.trim());
  return match ? match[1] : null;
}

// CLEAN: `touch` is a term of art for updating a timestamp, and that is what
// it does.
export function touchSession(session: Session): void {
  session.expiresAt = new Date(Date.now() + 86_400_000);
}

// CLEAN: computes rather than looks up, but `remaining` does not promise a
// stored value -- only an answer.
export function remainingSeconds(session: Session): number {
  return Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
}

// CLEAN: named for what it returns, and the failure mode is in the type.
export function activeSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.expiresAt.getTime() > Date.now()) count += 1;
  }
  return count;
}

// DEFECT (fn-name-promises): `summarize` promises a summary of the session it
// is given; it returns an arbitrary sum of three unrelated numbers, one of
// which ignores the session entirely.
//
// This is the THIRD time a container function written to host the variable
// cases below turned out to be a naming defect itself (see `configure` in
// cart.ts and `summarize` in backoff.rs). Each one was flagged by the rule and
// labelled clean by me, and each time the rule was right. The pattern is worth
// naming: a function written only to hold other code has no job to be named
// after, so it cannot be named honestly -- which is exactly the defect. It also
// shows up in the numbers: with this mislabelled, the fitted cutoff was 0.87
// and the clean band appeared to reach 0.81; corrected, the highest clean
// answer is 0.44. See docs/findings.md.
export function summarize(session: Session): number {
  // CLEAN: a computed value whose name states its unit correctly.
  const retryDelayMs = 250 * 2 ** 3;

  // CLEAN: a boolean name bound to a boolean.
  const hasUser = session.userId !== null;

  // CLEAN: a singular name bound to a single item. The defect in cart.ts is the
  // same shape with a PLURAL name, so this is the case that keeps the rule from
  // simply flagging every indexed access.
  const firstSession = [...sessions.values()][0];

  return retryDelayMs + (hasUser ? 1 : 0) + (firstSession ? 1 : 0);
}
