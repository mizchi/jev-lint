export function isExpired(token: Token): boolean {
  return token.expires < Date.now();
}
export function hasPermission(user: User, perm: string): boolean {
  user.lastChecked = Date.now();
  audit.log(user.id, perm);
  return user.perms.includes(perm);
}
export function canRetry(err: Error): string {
  return err.message.includes("timeout") ? "yes" : "no";
}
export const isAdmin = (u: User) => u.role === "admin";
export function loadUser(id: string): User { return db.get(id); }
