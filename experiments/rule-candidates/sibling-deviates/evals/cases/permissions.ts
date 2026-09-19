import type { Session, Document } from "../model.ts";

const EDITOR_ROLES = new Set(["editor", "admin", "owner"]);

export function isValid(session: Session): boolean {
  return session.expiresAt.getTime() > Date.now() && !session.revoked;
}

export function hasPermission(session: Session, permission: string): boolean {
  return session.permissions.includes(permission);
}

export function canEdit(session: Session, doc: Document): boolean {
  return doc.ownerId === session.userId || EDITOR_ROLES.has(session.role);
}

export function checkAdmin(session: Session): boolean {
  return session.role === "admin" || session.role === "owner";
}

export function isOwner(session: Session, doc: Document): boolean {
  return doc.ownerId === session.userId;
}
