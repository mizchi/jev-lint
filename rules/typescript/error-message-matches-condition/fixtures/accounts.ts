import type { AccountRepo, SignupInput, User } from "../types";

export class ForbiddenError extends Error {}
export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function deleteAccount(repo: AccountRepo, actor: User, targetId: string): Promise<void> {
  const target = await repo.find(targetId);
  if (!target) {
    throw new NotFoundError("account not found");
  }
  if (actor.role !== "admin" && actor.id !== target.id) {
    throw new NotFoundError("account not found");
  }
  await repo.delete(targetId);
}

export function validateSignup(input: SignupInput): void {
  if (!EMAIL_RE.test(input.email)) {
    throw new ValidationError("invalid email");
  }
  if (input.password.length < 12) {
    throw new ValidationError("invalid email");
  }
  if (input.displayName.trim() === "") {
    throw new ValidationError("display name is required");
  }
}

export function requireVerified(user: User): void {
  if (!user.emailVerified) {
    throw new ForbiddenError("verify your email before publishing");
  }
}

export function assertOwner(actor: User, doc: { ownerId: string }): void {
  if (doc.ownerId !== actor.id) {
    throw new ForbiddenError("forbidden");
  }
}

export function getSession(store: Map<string, { userId: string; expiresAt: number }>, token: string) {
  const session = store.get(token);
  if (!session) {
    throw new ForbiddenError("session expired");
  }
  if (session.expiresAt < Date.now()) {
    throw new ForbiddenError("session expired");
  }
  return session;
}
