import type { Db } from "../db.ts";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

const SELECT = "select id, email, display_name as displayName from users where id = ?";

export async function fetchUser(db: Db, id: string): Promise<User | null> {
  const row = await db.get<User>(SELECT, [id]);
  return row ?? null;
}

export async function loadTeam(db: Db, id: string): Promise<{ id: string; name: string }> {
  const row = await db.get<{ id: string; name: string }>("select id, name from teams where id = ?", [id]);
  if (!row) throw new NotFoundError("team", id);
  return row;
}

export class NotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} ${id} not found`);
  }
}
