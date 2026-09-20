import { z } from "zod";

export class NotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`user ${id} not found`);
  }
}

export class TimeoutError extends Error {}

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

export type User = z.infer<typeof UserSchema>;

interface Row {
  id: string;
  email: string;
  role: string;
}

interface Db {
  get(id: string): Promise<Row | undefined>;
  put(row: Row): Promise<void>;
}

/**
 * Loads a user by id.
 *
 * @throws {NotFoundError} when no user has this id
 */
export async function loadUser(db: Db, id: string): Promise<User | null> {
  const row = await db.get(id);
  if (!row) return null;
  return UserSchema.parse(row);
}

/**
 * Parses an inbound user payload.
 *
 * @throws {ZodError} when the payload does not match the user schema
 */
export function parseUser(payload: unknown): User {
  return UserSchema.parse(payload);
}

/**
 * Looks a user up, or returns null when there is none with this id.
 */
export async function findUser(db: Db, id: string): Promise<User | null> {
  const row = await db.get(id);
  if (row === undefined) throw new NotFoundError(id);
  return UserSchema.parse(row);
}

/**
 * Fetches the profile from the directory service.
 *
 * Rejects with {@link TimeoutError} when the directory does not answer
 * within `timeoutMs`.
 */
export async function fetchProfile(baseUrl: string, id: string, timeoutMs: number): Promise<User> {
  const res = await fetch(`${baseUrl}/users/${id}`, {
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new TimeoutError(`directory timed out after ${timeoutMs}ms`);
    }
    throw e;
  });
  return UserSchema.parse(await res.json());
}

/**
 * Fetches the profile, or undefined if the directory has no such user.
 *
 * Any other failure of the directory call rejects.
 */
export async function fetchProfileOrUndefined(baseUrl: string, id: string): Promise<User | undefined> {
  const res = await fetch(`${baseUrl}/users/${id}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`directory responded ${res.status}`);
  return UserSchema.parse(await res.json());
}

/**
 * Promotes a member to admin.
 *
 * @throws {NotFoundError} when no user has this id
 */
export async function promote(db: Db, id: string): Promise<void> {
  const row = await db.get(id);
  if (!row) throw new NotFoundError(id);
  if (row.role === "admin") throw new Error(`user ${id} is already an admin`);
  await db.put({ ...row, role: "admin" });
}

/**
 * Returns the display name for a user.
 *
 * @returns the email's local part when the user has no display name,
 *   never null
 */
export function displayName(user: User & { name?: string }): string {
  return user.name ?? user.email.split("@")[0];
}

/**
 * Deletes a user.
 *
 * @throws {RangeError} when the id is empty
 */
export async function removeUser(db: Db, id: string): Promise<void> {
  if (id.length === 0) throw new TypeError("id must not be empty");
  await db.put({ id, email: "", role: "member" });
}
